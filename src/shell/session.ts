// An open site: its files, drafts, Zola builds, page locations and component probes.
import { DELETED, DraftStore, isDeleted } from "../drafts.ts";
import { joinFrontMatter, splitFrontMatter } from "../markdown/frontmatter.ts";
import { commitFiles } from "../repo/commit.ts";
import { downloadFiles, GitHubError, loadRepo, rawUrl, rememberCommit, rememberNeeded, type LoadedRepo, type Progress, type RepoRef } from "../repo/github.ts";
import { missingFiles, servedFiles } from "../repo/lazy.ts";
import { markdownSettings, type RenderInfo } from "../markdown/zola-render.ts";
import { parse as parseToml } from "smol-toml";
import { inspectSite, SiteError, type SiteInfo } from "../repo/site.ts";
import { getLocalSite, localRepo } from "../site/local.ts";
import { findTheme, type ThemeAdapter } from "../themes/index.ts";
import { chromeOverrides, findPages } from "../zola/chrome.ts";
import { newPageText, rewriteLinks, slugify } from "./files.ts";
import { ZolaClient } from "../zola/client.ts";
import type { BuildResult } from "../zola/protocol.ts";
import { indexComponents, type ComponentInfo } from "../zola/components.ts";
import { parseProbe, probeKey, probePage, type ProbeCall, type ProbeResult } from "../zola/probe.ts";
import { probeContext, type ProbeContext } from "../zola/probecontext.ts";
import { SANDBOX_ORIGIN } from "../origins.ts";
import { connectSandbox, sendNotDownloaded, SiteTarget, SITE_PREFIX, VIEW_PREFIX } from "./site-host.ts";

export type OpenProgress = Progress | { stage: "building" };

/** A view build: whether it worked, Zola's errors, and the output's paths */
export interface ViewBuild {
  ok: boolean;
  errors: string[];
  files: Set<string>;
}

export interface BuildStatus {
  state: "idle" | "building" | "ok" | "failed";
  ms?: number;
  errors?: string[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
/** Files the app doesn't read: outside content/ (page bundles' images go into probe pages), they're only in the worker */
const BINARY = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|svg|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|pdf|zip|gz|wasm)$/i;
/** A build missing files that weren't downloaded is tried again with them, this often at most */
const FETCH_ROUNDS = 20;
/** View builds slower than this (the first, resizing images) aren't done in the background */
const WARM_VIEW_MS = 2000;

const contextKey = (context: string, call: ProbeCall) => `${context}\u0001${probeKey(call)}`;

export class Session {
  readonly baseUrl = `${SANDBOX_ORIGIN}${SITE_PREFIX}`;
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
  private cache = new SiteTarget("zdrafts-site", SITE_PREFIX);
  private viewCache = new SiteTarget("zdrafts-view", VIEW_PREFIX);
  /** The last view build, by what it was built from (viewKey) */
  private view: { key: string; build: Promise<ViewBuild> } | null = null;
  /** How the view was last built, once it has been: then it's rebuilt in the background while cheap */
  private viewed: { drafts: boolean; ms: number } | null = null;
  private warmTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<() => void>();
  private building: Promise<void> | null = null;
  private rebuildQueued = false;
  /** Every file of the repository, downloaded or not, and where only the worker has it */
  private paths: Set<string>;
  /** The not-downloaded files last told to the sandbox */
  private servedKey = "";

  private constructor(
    readonly repo: LoadedRepo,
    readonly site: SiteInfo,
    readonly theme: ThemeAdapter,
    readonly drafts: DraftStore,
    private zola: ZolaClient,
  ) {
    this.repoKey = repo.local ? repo.fullName : `${repo.owner}/${repo.repo}@${repo.ref}`;
    this.components = indexComponents(repo.files);
    this.paths = new Set(repo.entries.map((entry) => entry.path));
    drafts.onChange = () => {
      this.warmView();
      void this.syncNotDownloaded();
    };
  }

  static async open(ref: RepoRef, onProgress: (progress: OpenProgress) => void): Promise<Session> {
    const [repo] = await Promise.all([loadRepo(ref, onProgress), connectSandbox()]);
    return Session.start(repo, onProgress);
  }

  /** A site made in this browser (src/site/local.ts) */
  static async openLocal(id: string, onProgress: (progress: OpenProgress) => void): Promise<Session> {
    const [site] = await Promise.all([getLocalSite(id), connectSandbox()]);
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
    // Resized images are kept per repository (or site made here), whatever the branch
    // A site made here is published from these files, so it keeps them all
    const kept = (path: string) => !!repo.local || path.startsWith("content/") || !BINARY.test(path);
    const zola = new ZolaClient(site.zola, repo.files, repo.local ? `local:${repo.local}` : repo.fullName.toLowerCase(), kept);
    await zola.whenReady();
    const session = new Session(repo, site, theme, drafts, zola);
    await Promise.all([session.rebuild(), session.syncNotDownloaded()]);
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
    return draft !== undefined && !isDeleted(draft) && !this.paths.has(path);
  }

  isDeleted(path: string): boolean {
    return isDeleted(this.drafts.get(path));
  }

  exists(path: string): boolean {
    const draft = this.drafts.get(path);
    return draft !== undefined ? !isDeleted(draft) : this.paths.has(path);
  }

  /** Every page (Markdown under content/), as edited: added ones in, deleted ones out */
  get contentPages(): string[] {
    const paths = new Set([...this.paths, ...this.drafts.paths()]);
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

  /** The file as edited or as in the repository, if it's here: see readBytes for any file */
  bytes(path: string): Uint8Array | undefined {
    const draft = this.drafts.get(path);
    if (draft === undefined) return this.repo.files.get(path);
    if (isDeleted(draft)) return undefined;
    return typeof draft === "string" ? encoder.encode(draft) : draft;
  }

  /** Any file as edited or as in the repository: from the worker, or downloaded if it wasn't */
  async readBytes(path: string): Promise<Uint8Array | undefined> {
    const here = this.bytes(path);
    if (here || this.drafts.get(path) !== undefined || !this.paths.has(path)) return here;
    const entry = this.repo.notDownloaded.get(path);
    if (entry) return (await downloadFiles([entry])).get(path);
    return this.zola.read(path);
  }

  /** How Zola renders `path`'s links and headings: its URL, every page's, the site's settings */
  renderInfo(path: string): Omit<RenderInfo, "headings" | "anchor"> {
    const url = (output: string) => `${this.baseUrl}/${output.replace(/index\.html$/, "")}`;
    const output = this.pages.get(path);
    let config: Record<string, unknown> = {};
    try {
      config = parseToml(this.text(this.site.configPath)) as Record<string, unknown>;
    } catch {
      // A config being edited may not parse: Zola's defaults
    }
    return {
      pageUrl: output ? url(output) : `${this.baseUrl}/`,
      pages: Object.fromEntries([...this.pages].map(([content, out]) => [content.slice("content/".length), url(out)])),
      markdown: markdownSettings(config),
    };
  }

  /**
   * renderInfo, with the URLs of the pages `path` links to with @/ that the build didn't place
   * (sections without content, pages their template doesn't show): Zola gives them (get_url)
   */
  async renderInfoWithLinks(path: string): Promise<Omit<RenderInfo, "headings" | "anchor">> {
    const info = this.renderInfo(path);
    const targets = [...new Set([...this.text(path).matchAll(/@\/([^\s)"'#>]+)/g)].map((match) => match[1]))].filter((target) => !info.pages[target]);
    if (!targets.length) return info;
    const calls = targets.map((target): ProbeCall => ({ kind: "source", name: "inline", args: `{{ get_url(path=${JSON.stringify(`@/${target}`)}) }}` }));
    const results = await this.probe(calls, path);
    targets.forEach((target, i) => {
      const html = results.get(probeKey(calls[i]))?.html;
      if (html) info.pages[target] = new DOMParser().parseFromString(html, "text/html").body.textContent!.trim();
    });
    return info;
  }

  /** A page's language, as Zola gives it: "post.fr.md" is French if the site has French, else the default */
  language(path: string): string {
    const config = this.site.config as { default_language?: string; languages?: Record<string, unknown> };
    const suffix = /\.([a-z]{2,3}(?:-\w+)?)\.md$/i.exec(path)?.[1];
    return suffix && config.languages && suffix in config.languages ? suffix : (config.default_language ?? "en");
  }

  /** Tell the sandbox where the files not downloaded are, unless a draft replaces or deletes them */
  private async syncNotDownloaded(): Promise<void> {
    const waiting = [...this.repo.notDownloaded.keys()].filter((path) => this.drafts.get(path) === undefined);
    const served = [...servedFiles(waiting, this.site.theme)].map(([at, path]): [string, string] => [at, rawUrl(this.repo.notDownloaded.get(path)!)]);
    const key = served.map(([at, url]) => `${at} ${url}`).join("\n");
    if (key === this.servedKey) return;
    this.servedKey = key;
    await sendNotDownloaded(served);
  }

  /**
   * Build, downloading files that weren't downloaded when a failed build names them (a stylesheet
   * hashed by get_url(cachebust=true)…): they're remembered for the next time the site opens.
   */
  private async build(overrides: Map<string, Uint8Array | null>, baseUrl: string, options?: Parameters<ZolaClient["build"]>[2]): Promise<BuildResult> {
    for (let round = 0; ; round++) {
      const result = await this.zola.build(overrides, baseUrl, options);
      if (result.ok || round >= FETCH_ROUNDS || !this.repo.notDownloaded.size) return result;
      const missing = missingFiles(result.stderr, this.repo.notDownloaded.keys());
      if (!missing.length) return result;
      const files = await downloadFiles(missing.map((path) => this.repo.notDownloaded.get(path)!));
      for (const path of missing) this.repo.notDownloaded.delete(path);
      this.zola.update(files);
      void rememberNeeded(this.repo.fullName, missing);
    }
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
    // (A copy: the sandbox takes the buffer, and the draft keeps this one)
    await this.cache.write(new Map([[path.slice("static/".length), data.slice()]]));
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
    const data = draft !== undefined && !isDeleted(draft) ? draft : path.endsWith(".md") ? this.text(path) : await this.readBytes(path);
    if (data === undefined) throw new Error(`${path} couldn't be read.`);
    await this.drafts.put(to, data);
    if (this.paths.has(path)) await this.drafts.put(path, DELETED);
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
    if (this.paths.has(path)) await this.drafts.put(path, DELETED);
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
    const before = this.layoutOf(path);
    const { frontMatter } = splitFrontMatter(this.text(path));
    // The editor writes \n; a file with \r\n line endings keeps them
    if (this.text(path).includes("\r\n")) body = body.replace(/\r?\n/g, "\r\n");
    await this.drafts.save(path, joinFrontMatter(frontMatter, body), this.original(path));
    this.emit();
    // All of it deleted (or written again): the page's place in the chrome build changes
    if (this.layoutOf(path) !== before) this.scheduleRebuild();
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
    // A page's front matter, and whether it has content (the chrome build has no marker without it)
    if (this.contentPages.includes(path)) {
      const { frontMatter, body } = splitFrontMatter(this.text(path));
      return `${frontMatter}\u0000${!body.trim()}`;
    }
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
      if (data === null) this.paths.delete(path);
      else this.paths.add(path);
      this.repo.notDownloaded.delete(path);
      await this.drafts.discard(path);
    }
    // The worker builds from the repository's files: they're the committed ones now
    this.zola.update(new Map([...files.keys()].map((path) => [path, this.repo.files.get(path) ?? null])));
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
    const overrides: Map<string, Uint8Array | null> = chromeOverrides(this.contentPages, (path) => this.text(path), (path) => this.language(path));
    // Edited config, added images…: everything else that has a draft
    for (const path of this.drafts.paths()) if (!overrides.has(path)) overrides.set(path, this.bytes(path) ?? null);
    // One probe page per context, each rendering its calls
    const probing = [...this.probeCalls].filter(([, calls]) => calls.size);
    const probePaths: string[] = [];
    for (const [id, calls] of probing) probePaths.push(...this.addProbePage(overrides, id, [...calls.values()]));

    let result = await this.build(overrides, this.baseUrl, { target: "site" });
    if (!result.ok && probing.length) {
      // A component call failed (e.g. an image that doesn't exist): build without the probe pages
      // so the site still updates, then find which calls fail
      for (const path of probePaths) overrides.delete(path);
      const plain = await this.build(overrides, this.baseUrl, { target: "site" });
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
      this.pages = findPages(result.files);
      await this.publish(this.cache, result);
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
      const result = await this.build(single, this.baseUrl);
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

  /** What a view build depends on: the commit, the drafts and whether draft pages are built */
  viewKey(drafts: boolean): string {
    return `${this.repo.commit}:${drafts}:${this.drafts.revision}`;
  }

  /**
   * Build the site as `zola build` would, with the drafts applied: real page bodies, the config as
   * it is (minify_html included), no editor and no probe pages. Draft pages (draft = true) are left
   * out unless `drafts`, as `zola serve --drafts` does. Published to /view/; the same inputs
   * aren't built twice.
   */
  buildView(drafts: boolean): Promise<ViewBuild> {
    const key = this.viewKey(drafts);
    if (this.view?.key === key) return this.view.build;
    const overrides = new Map<string, Uint8Array | null>();
    for (const path of this.drafts.paths()) overrides.set(path, this.bytes(path) ?? null);
    const previous = this.view?.build;
    const started = performance.now();
    const build = this.build(overrides, `${SANDBOX_ORIGIN}${VIEW_PREFIX}`, { drafts, target: "view", complete: true }).then(async (result) => {
      // Builds finish in order; so do their writes to the cache
      await previous;
      const files = new Set(result.files.keys());
      if (result.ok) await this.publish(this.viewCache, result);
      this.viewed = { drafts, ms: performance.now() - started };
      return { ok: result.ok, errors: result.stderr, files };
    });
    this.view = { key, build };
    return build;
  }

  /**
   * Once the view has been looked at, keep it built while editing, when that's quick (resized
   * images are reused): it's then ready when it's looked at again.
   */
  private warmView() {
    clearTimeout(this.warmTimer);
    const viewed = this.viewed;
    if (!viewed || viewed.ms > WARM_VIEW_MS) return;
    this.warmTimer = setTimeout(() => void this.buildView(viewed.drafts), 1500);
  }

  /** Send what changed in a build to the sandbox (the buffers go with it) */
  private publish(target: SiteTarget, result: BuildResult): Promise<void> {
    const puts = new Map(result.changed.map((path) => [path, result.files.get(path)!]));
    return target.write(puts, result.removed, result.fresh);
  }

  /** The view's URL of an output file ("posts/a/index.html" → ".../view/posts/a/") */
  static viewUrlOf(output: string): string {
    return `${SANDBOX_ORIGIN}${VIEW_PREFIX}/${output.replace(/index\.html$/, "")}`;
  }

  /** URL of a content page in the preview, or null if its template doesn't show its content */
  pageUrl(path: string, edit: boolean): string | null {
    const output = this.pages.get(path);
    if (!output) return null;
    const url = `${SANDBOX_ORIGIN}${SITE_PREFIX}/${output.replace(/index\.html$/, "")}`;
    return edit ? `${url}?zdrafts-edit=${encodeURIComponent(path)}` : url;
  }

  /**
   * Where a link clicked in the site leads: one of its content pages, another page of the built
   * site (shown as a preview: taxonomies, search…), or somewhere outside it.
   */
  resolveLink(href: string): { kind: "page"; path: string } | { kind: "preview"; url: string } | { kind: "external"; href: string } {
    const target = new URL(href, SANDBOX_ORIGIN);
    if (target.origin !== SANDBOX_ORIGIN) return { kind: "external", href: target.href };
    // The site is built for /site/, but themes and menus often link root-relative ("/posts")
    const inSite = target.pathname === SITE_PREFIX || target.pathname.startsWith(`${SITE_PREFIX}/`);
    const sitePath = (inSite ? target.pathname.slice(SITE_PREFIX.length) : target.pathname).replace(/^\/?/, "/");
    const last = sitePath.split("/").pop()!;
    if (/\.(?!html$)\w+$/.test(last)) return { kind: "external", href: `${SANDBOX_ORIGIN}${SITE_PREFIX}${sitePath}` }; // feeds, files
    const output = (last.endsWith(".html") ? sitePath : sitePath.replace(/\/?$/, "/index.html")).slice(1);
    for (const [path, out] of this.pages) if (out === output) return { kind: "page", path };
    return { kind: "preview", url: `${SANDBOX_ORIGIN}${SITE_PREFIX}${sitePath}${target.search}${target.hash}` };
  }

  dispose() {
    clearTimeout(this.warmTimer);
    this.drafts.onChange = null;
    this.zola.dispose();
  }
}

export { SiteError };
