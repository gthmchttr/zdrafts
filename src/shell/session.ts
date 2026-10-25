// An open site: its files, drafts, Zola builds, page locations and component probes.
import { DraftStore } from "../drafts.ts";
import { joinFrontMatter, splitFrontMatter } from "../markdown/frontmatter.ts";
import { loadRepo, type LoadedRepo, type Progress, type RepoRef } from "../repo/github.ts";
import { inspectSite, SiteError, type SiteInfo } from "../repo/site.ts";
import { findTheme, type ThemeAdapter } from "../themes/index.ts";
import { chromeOverrides, findPages } from "../zola/chrome.ts";
import { ZolaClient } from "../zola/client.ts";
import { indexComponents, type ComponentInfo } from "../zola/components.ts";
import { parseProbe, PROBE_CONTENT, probeKey, probePage, type ProbeCall, type ProbeResult } from "../zola/probe.ts";
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

export class UnsupportedThemeError extends Error {
  constructor(public site: SiteInfo) {
    super(
      site.theme
        ? `zdrafts doesn't support the "${site.theme}" theme yet. Themes are added once their components have been tested.`
        : "zdrafts needs a site that uses a supported theme (currently zola-yolk).",
    );
  }
}

export class Session {
  readonly baseUrl = `${location.origin}${SITE_PREFIX}`;
  readonly repoKey: string;
  readonly contentPages: string[];
  readonly components: Map<string, ComponentInfo>;
  pages = new Map<string, string>();
  status: BuildStatus = { state: "idle" };
  /** Bumped when a build changed what pages look like (front matter edits), so open pages reload */
  layoutVersion = 0;
  private layoutDirty = false;
  private probes = new Map<string, ProbeResult>();
  private probeCalls = new Map<string, ProbeCall>();
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
    this.repoKey = `${repo.owner}/${repo.repo}@${repo.ref}`;
    this.contentPages = [...repo.files.keys()].filter((path) => path.startsWith("content/") && path.endsWith(".md")).sort();
    this.components = indexComponents(repo.files);
  }

  static async open(ref: RepoRef, onProgress: (progress: OpenProgress) => void): Promise<Session> {
    const [repo] = await Promise.all([loadRepo(ref, onProgress), registerServiceWorker()]);
    const site = inspectSite(repo.files);
    if (!site.zola) {
      throw new SiteError(`This site deploys with Zola ${site.declaredZola}; zdrafts currently supports Zola 0.23.`);
    }
    const theme = findTheme(site.theme, repo.files);
    if (!theme) throw new UnsupportedThemeError(site);
    const drafts = new DraftStore(`${repo.owner}/${repo.repo}@${repo.ref}`);
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

  /** Files shown in the explorer: the site's own content/ and static/ (not the theme's) */
  explorerPaths(): string[] {
    return this.repo.entries
      .filter((entry) => entry.source === `${this.repo.owner}/${this.repo.repo}` || entry.source.toLowerCase() === `${this.repo.owner}/${this.repo.repo}`.toLowerCase())
      .map((entry) => entry.path)
      .filter((path) => path.startsWith("content/") || path.startsWith("static/"))
      .sort();
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
    return this.drafts.get(path) ?? this.original(path);
  }

  isModified(path: string): boolean {
    return this.drafts.get(path) !== undefined;
  }

  bytes(path: string): Uint8Array | undefined {
    const draft = this.drafts.get(path);
    return draft !== undefined ? encoder.encode(draft) : this.repo.files.get(path);
  }

  /** Save the body of a page from the editor, keeping its (possibly edited) front matter */
  async saveBody(path: string, body: string): Promise<void> {
    const { frontMatter } = splitFrontMatter(this.text(path));
    await this.drafts.save(path, joinFrontMatter(frontMatter, body), this.original(path));
    this.emit();
  }

  /** Save a whole file (front matter or source edits); front matter changes need a rebuild */
  async saveText(path: string, text: string): Promise<void> {
    const before = splitFrontMatter(this.text(path)).frontMatter;
    await this.drafts.save(path, text, this.original(path));
    this.emit();
    if (splitFrontMatter(text).frontMatter !== before) this.scheduleRebuild();
  }

  async discard(path: string): Promise<void> {
    const before = splitFrontMatter(this.text(path)).frontMatter;
    await this.drafts.discard(path);
    this.emit();
    if (splitFrontMatter(this.text(path)).frontMatter !== before) this.scheduleRebuild();
  }

  /** Rebuild because pages' front matter changed: open pages reload once it's done */
  scheduleRebuild() {
    this.layoutDirty = true;
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
    const calls = [...this.probeCalls.values()];
    if (calls.length) overrides.set(PROBE_CONTENT, encoder.encode(probePage(calls)));

    let result = await this.zola.build(overrides, this.baseUrl);
    if (!result.ok && calls.length) {
      // A component call failed (e.g. an image that doesn't exist): build without the probe page
      // so the site still updates, then find which calls fail
      overrides.delete(PROBE_CONTENT);
      const plain = await this.zola.build(overrides, this.baseUrl);
      if (plain.ok) {
        result = plain;
        await this.probeIndividually(calls, overrides);
      }
    } else if (result.ok && calls.length) {
      const html = result.files.get("__zdrafts__/probe/index.html");
      const results = html ? parseProbe(decoder.decode(html), calls) : calls.map(() => ({ html: "", slot: false, error: "No probe output" }));
      calls.forEach((call, i) => this.probes.set(probeKey(call), results[i]));
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

  private async probeIndividually(calls: ProbeCall[], overrides: Map<string, Uint8Array | null>) {
    for (const call of calls) {
      const key = probeKey(call);
      if (this.probes.has(key) && !this.probes.get(key)!.error) continue;
      const single = new Map(overrides);
      single.set(PROBE_CONTENT, encoder.encode(probePage([call])));
      const result = await this.zola.build(single, this.baseUrl);
      const html = result.files.get("__zdrafts__/probe/index.html");
      if (result.ok && html) this.probes.set(key, parseProbe(decoder.decode(html), [call])[0]);
      else {
        const error = result.stderr.filter((line) => !/^(Building site|Done in)/.test(line)).slice(-6).join("\n");
        this.probes.set(key, { html: "", slot: false, error: error || "Zola couldn't render this component" });
        this.probeCalls.delete(key);
      }
    }
  }

  /** Results for these calls, rendering the ones not seen before */
  async probe(calls: ProbeCall[]): Promise<Map<string, ProbeResult>> {
    let fresh = false;
    for (const call of calls) {
      const key = probeKey(call);
      if (!this.probeCalls.has(key) && !this.probes.has(key)) {
        this.probeCalls.set(key, call);
        fresh = true;
      }
    }
    if (fresh) await this.rebuild();
    if (this.building) await this.building;
    return new Map(calls.map((call) => [probeKey(call), this.probes.get(probeKey(call)) ?? { html: "", slot: false, error: "Not rendered" }]));
  }

  /** URL of a content page in the preview, or null if its template doesn't show its content */
  pageUrl(path: string, edit: boolean): string | null {
    const output = this.pages.get(path);
    if (!output) return null;
    const url = `${SITE_PREFIX}/${output.replace(/index\.html$/, "")}`;
    return edit ? `${url}?zdrafts-edit=${encodeURIComponent(path)}` : url;
  }

  dispose() {
    this.zola.dispose();
  }
}

export { SiteError };
