// An open site: its files, drafts, Zola builds, page locations and component probes.
import { DELETED, DraftStore, isDeleted } from "../drafts.ts";
import { joinFrontMatter, splitFrontMatter } from "../markdown/frontmatter.ts";
import { commitFiles } from "../repo/commit.ts";
import { GitHubError, loadRepo, rememberCommit, type LoadedRepo, type Progress, type RepoRef } from "../repo/github.ts";
import { inspectSite, SiteError, type SiteInfo } from "../repo/site.ts";
import { getLocalSite, localRepo } from "../site/local.ts";
import { findTheme, type ThemeAdapter } from "../themes/index.ts";
import { chromeOverrides, findPages, previewConfig } from "../zola/chrome.ts";
import { newPageText, rewriteLinks, slugify } from "./files.ts";
import { ZolaClient } from "../zola/client.ts";
import { indexComponents, type ComponentInfo } from "../zola/components.ts";
import { parseProbe, probeKey, probePage, type ProbeCall, type ProbeResult } from "../zola/probe.ts";
import { probeContext, type ProbeContext } from "../zola/probecontext.ts";
import { registerServiceWorker, SiteCache, SITE_PREFIX } from "./site-cache.ts";

export type OpenProgress = Progress | { stage: "building" };

export interface BuildStatus {
  state: "idle" | "building" | "ok" | "failed";
  ms?: number;
  errors?: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

const contextKey = (context: string, call: ProbeCall) => `${context}\u0001${probeKey(call)}`;

export class Session {
  readonly baseUrl = `${location.origin}${SITE_PREFIX}`;
  readonly repoKey: string;
  readonly components: Map<string, ComponentInfo>;
  pages = new Map<string, string>();
  status: BuildStatus = { state: "idle" };
  /** Bumped when a build changed what pages look like (front matter edits), so open pages reload */
  layoutVersion = 0;
  private layoutDirty = false;
  /** Probe results by context and call (contextKey) */
  private probes = new Map<string, ProbeResult>();
  /** Calls each probe page renders in every build, by context id */
  private probeCalls = new Map<string, Map<string, ProbeCall>>();
  /** How components are probed for each page (see src/zola/probecontext.ts), with the probe page's folder */
  private probeContexts = new Map<string, ProbeContext & { dir: string }>();
  private cache = new SiteCache();
  private listeners = new Set<() => void>();
  private building: Promise<void> | null = null;
  private rebuildQueued = false;

  private constructor(
    readonly repo: LoadedRepo,
    readonly site: SiteInfo,
    readonly theme: ThemeAdapter,
    readonly drafts: DraftStore,
    private zola: ZolaClient,
  ) {
    this.repoKey = repo.local ? repo.fullName : `${repo.owner}/${repo.repo}@${repo.ref}`;
    this.components = indexComponents(repo.files);
  }

  static async open(ref: RepoRef, onProgress: (progress: OpenProgress) => void): Promise<Session> {
    const [repo] = await Promise.all([loadRepo(ref, onProgress), registerServiceWorker()]);
    return Session.start(repo, onProgress);
  }

  /** A site made in this browser (src/site/local.ts) */
  static async openLocal(id: string, onProgress: (progress: OpenProgress) => void): Promise<Session> {
    const [site] = await Promise.all([getLocalSite(id), registerServiceWorker()]);
    if (!site) throw new SiteError("That site isn't in this browser any more.");
    return Session.start(localRepo(site), onProgress);
  }

  private static async start(repo: LoadedRepo, onProgress: (progress: OpenProgress) => void): Promise<Session> {
    const site = inspectSite(repo.files);
    if (!site.zola) {
      throw new SiteError(`This site deploys with Zola ${site.declaredZola}; zdrafts currently supports Zola 0.23.`);
    }
    const theme = findTheme(site.theme, repo.files);
    // A local site's drafts go by its id; a repository's by name and branch
    const drafts = new DraftStore(repo.local ? repo.fullName : `${repo.owner}/${repo.repo}@${repo.ref}`);
    await drafts.load();
    onProgress({ stage: "building" });
    const zola = new ZolaClient(site.zola, repo.files);
    await zola.whenReady();
    const session = new Session(repo, site, theme, drafts, zola);
    await session.rebuild();
    return session;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  /** Files shown in the explorer: the site's config and its own content/ and static/ (not the theme's), added files included */
  explorerPaths(): string[] {
    const own = this.repo.entries
      .filter((entry) => entry.source.toLowerCase() === this.repo.fullName.toLowerCase())
      .map((entry) => entry.path)
      .filter((path) => path.startsWith("content/") || path.startsWith("static/") || path === this.site.configPath);
    return [...new Set([...own, ...this.drafts.paths()])].filter((path) => this.exists(path)).sort();
  }

  /** Files that don't exist in the repository yet (added here) */
  isAdded(path: string): boolean {
    const draft = this.drafts.get(path);
    return draft !== undefined && !isDeleted(draft) && !this.repo.files.has(path);
  }

  isDeleted(path: string): boolean {
    return isDeleted(this.drafts.get(path));
  }

  exists(path: string): boolean {
    const draft = this.drafts.get(path);
    return draft !== undefined ? !isDeleted(draft) : this.repo.files.has(path);
  }

  /** Every page (Markdown under content/), as edited: added ones in, deleted ones out */
  get contentPages(): string[] {
    const paths = new Set([...this.repo.files.keys(), ...this.drafts.paths()]);
    return [...paths].filter((path) => path.startsWith("content/") && path.endsWith(".md") && this.exists(path)).sort();
  }

  staticImages(): string[] {
    return this.explorerPaths().filter((path) => path.startsWith("static/") && IMAGE.test(path) && !path.startsWith("static/processed_images/"));
  }

  original(path: string): string {
    const data = this.repo.files.get(path);
    return data ? decoder.decode(data) : "";
  }

  /** The file as edited (draft) or as in the repository */
  text(path: string): string {
    const draft = this.drafts.get(path);
    if (draft === undefined) return this.original(path);
    if (isDeleted(draft)) return "";
    return typeof draft === "string" ? draft : decoder.decode(draft);
  }

  isModified(path: string): boolean {
    return this.drafts.get(path) !== undefined;
  }

  bytes(path: string): Uint8Array | undefined {
    const draft = this.drafts.get(path);
    if (draft === undefined) return this.repo.files.get(path);
    if (isDeleted(draft)) return undefined;
    return typeof draft === "string" ? encoder.encode(draft) : draft;
  }

  /**
   * Add a file (a dropped or pasted image) under static/, next to a free name, and serve it right
   * away so the editor can show it before the next build. Returns its path in the repository.
   */
  async addAsset(name: string, data: Uint8Array): Promise<string> {
    const clean = name.normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "image";
    const dot = clean.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [clean.slice(0, dot), clean.slice(dot)] : [clean, ""];
    let path = `static/images/${clean}`;
    for (let n = 2; this.exists(path); n++) path = `static/images/${stem}-${n}${ext}`;
    await this.drafts.put(path, data);
    await this.cache.write(new Map([[path.slice("static/".length), data]]), false);
    this.emit();
    this.scheduleRebuild(false);
    return path;
  }

  /** The front matter format most of the site's pages use */
  private pageFormat(): "toml" | "yaml" {
    let yaml = 0;
    const pages = this.contentPages;
    for (const path of pages) if (this.text(path).startsWith("---")) yaml++;
    return yaml * 2 > pages.length ? "yaml" : "toml";
  }

  /** Create a page (folder/slug.md) or a section (folder/slug/_index.md); returns its path */
  async createPage(folder: string, title: string, kind: "page" | "section"): Promise<string> {
    const slug = slugify(title);
    const path = kind === "page" ? `${folder}/${slug}.md` : `${folder}/${slug}/_index.md`;
    if (this.exists(path)) throw new Error(`${path} already exists.`);
    await this.drafts.put(path, newPageText(title, kind, this.pageFormat()));
    this.emit();
    this.scheduleRebuild();
    return path;
  }

  /**
   * Move or rename a file. Links to it in other pages follow it; returns how many pages changed.
   */
  async move(path: string, to: string): Promise<number> {
    if (!this.exists(path)) throw new Error(`${path} doesn't exist.`);
    if (this.exists(to)) throw new Error(`${to} already exists.`);
    const draft = this.drafts.get(path);
    const data = draft !== undefined && !isDeleted(draft) ? draft : path.endsWith(".md") ? this.text(path) : this.bytes(path)!;
    await this.drafts.put(to, data);
    if (this.repo.files.has(path)) await this.drafts.put(path, DELETED);
    else await this.drafts.discard(path);
    let updated = 0;
    for (const page of this.contentPages) {
      const text = this.text(page);
      const next = rewriteLinks(text, path, to);
      if (next !== text) {
        await this.drafts.save(page, next, this.original(page));
        updated++;
      }
    }
    this.emit();
    this.scheduleRebuild();
    return updated;
  }

  async remove(path: string): Promise<void> {
    if (this.repo.files.has(path)) await this.drafts.put(path, DELETED);
    else await this.drafts.discard(path);
    this.emit();
    this.scheduleRebuild();
  }

  /** A static/ file's URL on the site ("/images/a.png") */
  static siteUrlOf(path: string): string {
    return `/${path.replace(/^static\//, "")}`;
  }

  /** Save the body of a page from the editor, keeping its (possibly edited) front matter */
  async saveBody(path: string, body: string): Promise<void> {
    const { frontMatter } = splitFrontMatter(this.text(path));
    // The editor writes \n; a file with \r\n line endings keeps them
    if (this.text(path).includes("\r\n")) body = body.replace(/\r?\n/g, "\r\n");
    await this.drafts.save(path, joinFrontMatter(frontMatter, body), this.original(path));
    this.emit();
  }

  /** Save a whole file (front matter, source or config edits); some changes need a rebuild */
  async saveText(path: string, text: string): Promise<void> {
    const before = this.layoutOf(path);
    await this.drafts.save(path, text, this.original(path));
    this.emit();
    if (this.layoutOf(path) !== before) this.scheduleRebuild();
  }

  async discard(path: string): Promise<void> {
    const before = this.layoutOf(path);
    await this.drafts.discard(path);
    this.emit();
    if (this.layoutOf(path) !== before) this.scheduleRebuild();
  }

  /** What of a file the chrome build uses: a page's front matter, or all of any other file */
  private layoutOf(path: string): string {
    if (this.contentPages.includes(path)) return splitFrontMatter(this.text(path)).frontMatter;
    const data = this.bytes(path);
    return data ? `${data.length}:${decoder.decode(data.slice(0, 4096))}:${this.drafts.get(path) === undefined}` : "";
  }

  /** Commit the drafts of `paths` to the branch; they become the files' new originals */
  async commit(paths: string[], message: string): Promise<string> {
    const files = new Map(
      paths.map((path): [string, string | Uint8Array | null] => {
        const draft = this.drafts.get(path);
        return [path, isDeleted(draft) ? null : (draft ?? this.text(path))];
      }),
    );
    const { fullName, ref: branch } = this.repo;
    let sha: string;
    try {
      sha = await commitFiles({ fullName, branch, base: this.repo.commit, files, message });
    } catch (error) {
      // The branch moved on: the next load must fetch its latest commit
      if (error instanceof GitHubError && error.kind === "conflict") await rememberCommit(fullName, branch, null);
      throw error;
    }
    this.repo.commit = sha;
    await rememberCommit(fullName, branch, sha);
    for (const [path, data] of files) {
      if (data === null) this.repo.files.delete(path);
      else this.repo.files.set(path, typeof data === "string" ? encoder.encode(data) : data);
      await this.drafts.discard(path);
    }
    this.emit();
    return sha;
  }

  /** Rebuild because pages' front matter or the site's files changed; open pages reload once it's done unless `reload` is false */
  scheduleRebuild(reload = true) {
    if (reload) this.layoutDirty = true;
    if (this.building) {
      this.rebuildQueued = true;
      return;
    }
    void this.rebuild();
  }

  /** Build the chrome (every page with a marker body) plus the probe page, and publish it to /site/ */
  async rebuild(): Promise<void> {
    if (this.building) {
      this.rebuildQueued = true;
      return this.building;
    }
    this.building = this.doRebuild().finally(() => {
      this.building = null;
      if (this.rebuildQueued) {
        this.rebuildQueued = false;
        void this.rebuild();
      }
    });
    return this.building;
  }

  private async doRebuild(): Promise<void> {
    this.status = { state: "building" };
    this.emit();
    const overrides: Map<string, Uint8Array | null> = chromeOverrides(this.contentPages, (path) => this.text(path));
    // Edited config, added images…: everything else that has a draft
    for (const path of this.drafts.paths()) if (!overrides.has(path)) overrides.set(path, this.bytes(path) ?? null);
    const config = previewConfig(this.text(this.site.configPath));
    if (config !== null) overrides.set(this.site.configPath, encoder.encode(config));
    // One probe page per context, each rendering its calls
    const probing = [...this.probeCalls].filter(([, calls]) => calls.size);
    const probePaths: string[] = [];
    for (const [id, calls] of probing) probePaths.push(...this.addProbePage(overrides, id, [...calls.values()]));

    let result = await this.zola.build(overrides, this.baseUrl);
    if (!result.ok && probing.length) {
      // A component call failed (e.g. an image that doesn't exist): build without the probe pages
      // so the site still updates, then find which calls fail
      for (const path of probePaths) overrides.delete(path);
      const plain = await this.zola.build(overrides, this.baseUrl);
      if (plain.ok) {
        result = plain;
        for (const [id, calls] of probing) await this.probeIndividually(id, [...calls.values()], overrides);
      }
    } else if (result.ok) {
      for (const [id, calls] of probing) {
        const list = [...calls.values()];
        const html = result.files.get(`${this.probeContexts.get(id)!.dir.slice("content/".length)}/index.html`);
        const results = html ? parseProbe(decoder.decode(html), list) : list.map(() => ({ html: "", slot: false, error: "No probe output" }));
        list.forEach((call, i) => {
          this.probes.set(contextKey(id, call), results[i]);
          // Highlighted code needs no files, so later builds can leave it out. Components stay in:
          // Zola prunes processed images (e.g. resized by img) that a build doesn't use.
          if (call.kind === "code") calls.delete(probeKey(call));
        });
      }
    }

    if (result.ok) {
      await this.cache.write(result.files);
      this.pages = findPages(result.files);
      this.status = { state: "ok", ms: result.ms };
      if (this.layoutDirty) {
        this.layoutDirty = false;
        this.layoutVersion++;
      }
    } else {
      this.status = { state: "failed", errors: result.stderr };
    }
    this.emit();
  }

  /** Put a context's probe page (and the edited page's co-located files) into `overrides` */
  private addProbePage(overrides: Map<string, Uint8Array | null>, id: string, calls: ProbeCall[]): string[] {
    const context = this.probeContexts.get(id)!;
    const page = `${context.dir}/index.md`;
    overrides.set(page, encoder.encode(probePage(calls, context.frontMatter)));
    const paths = [page];
    for (const [relative, source] of context.assets) {
      const data = this.bytes(source);
      if (!data) continue;
      overrides.set(`${context.dir}/${relative}`, data);
      paths.push(`${context.dir}/${relative}`);
    }
    return paths;
  }

  private async probeIndividually(id: string, calls: ProbeCall[], overrides: Map<string, Uint8Array | null>) {
    const pending = this.probeCalls.get(id)!;
    const output = `${this.probeContexts.get(id)!.dir.slice("content/".length)}/index.html`;
    for (const call of calls) {
      const key = contextKey(id, call);
      if (this.probes.has(key) && !this.probes.get(key)!.error) continue;
      const single = new Map(overrides);
      this.addProbePage(single, id, [call]);
      const result = await this.zola.build(single, this.baseUrl);
      const html = result.files.get(output);
      if (result.ok && html) {
        this.probes.set(key, parseProbe(decoder.decode(html), [call])[0]);
        if (call.kind === "code") pending.delete(probeKey(call));
      } else {
        const error = result.stderr.filter((line) => !/^(Building site|Done in)/.test(line)).slice(-6).join("\n");
        this.probes.set(key, { html: "", slot: false, error: error || "Zola couldn't render this component" });
        pending.delete(probeKey(call));
      }
    }
  }

  /** Results for these calls on `page`, rendering the ones not seen before */
  async probe(calls: ProbeCall[], page: string): Promise<Map<string, ProbeResult>> {
    const context = probeContext(page, (path) => (this.exists(path) ? this.text(path) : undefined), this.explorerPaths());
    if (!this.probeContexts.has(context.id)) {
      this.probeContexts.set(context.id, { ...context, dir: `content/__zdrafts__/probe-${this.probeContexts.size}` });
      this.probeCalls.set(context.id, new Map());
    }
    const pending = this.probeCalls.get(context.id)!;
    let fresh = false;
    for (const call of calls) {
      if (!pending.has(probeKey(call)) && !this.probes.has(contextKey(context.id, call))) {
        pending.set(probeKey(call), call);
        fresh = true;
      }
    }
    if (fresh) await this.rebuild();
    if (this.building) await this.building;
    return new Map(calls.map((call) => [probeKey(call), this.probes.get(contextKey(context.id, call)) ?? { html: "", slot: false, error: "Not rendered" }]));
  }

  /** URL of a content page in the preview, or null if its template doesn't show its content */
  pageUrl(path: string, edit: boolean): string | null {
    const output = this.pages.get(path);
    if (!output) return null;
    const url = `${SITE_PREFIX}/${output.replace(/index\.html$/, "")}`;
    return edit ? `${url}?zdrafts-edit=${encodeURIComponent(path)}` : url;
  }

  /**
   * Where a link clicked in the site leads: one of its content pages, another page of the built
   * site (shown as a preview: taxonomies, search…), or somewhere outside it.
   */
  resolveLink(href: string): { kind: "page"; path: string } | { kind: "preview"; url: string } | { kind: "external"; href: string } {
    const target = new URL(href, location.href);
    if (target.origin !== location.origin) return { kind: "external", href: target.href };
    // The site is built for /site/, but themes and menus often link root-relative ("/posts")
    const inSite = target.pathname === SITE_PREFIX || target.pathname.startsWith(`${SITE_PREFIX}/`);
    const sitePath = (inSite ? target.pathname.slice(SITE_PREFIX.length) : target.pathname).replace(/^\/?/, "/");
    const last = sitePath.split("/").pop()!;
    if (/\.(?!html$)\w+$/.test(last)) return { kind: "external", href: `${SITE_PREFIX}${sitePath}` }; // feeds, files
    const output = (last.endsWith(".html") ? sitePath : sitePath.replace(/\/?$/, "/index.html")).slice(1);
    for (const [path, out] of this.pages) if (out === output) return { kind: "page", path };
    return { kind: "preview", url: `${SITE_PREFIX}${sitePath}${target.search}${target.hash}` };
  }

  dispose() {
    this.zola.dispose();
  }
}

export { SiteError };
