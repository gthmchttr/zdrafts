// Sites made in this browser: kept in IndexedDB until they're published to GitHub. Edits to them
// are drafts like any site's; a site's record holds the files it was created with.
import { createStore, del, entries, get, set } from "idb-keyval";
import type { LoadedRepo, Progress } from "../repo/github.ts";
import type { CatalogTheme } from "../themes/catalog.ts";
import { ZolaClient } from "../zola/client.ts";
import { prepareSite } from "./newsite.ts";
import { downloadTheme } from "./themes.ts";

export interface LocalSite {
  id: string;
  title: string;
  /** Directory under themes/ */
  themeDir: string;
  themeName: string;
  themeRepo: string;
  themeCommit: string;
  created: number;
  files: Map<string, Uint8Array>;
  /** Demo pages left out because they don't build in a browser */
  dropped: string[];
  starter: boolean;
  /** "owner/repo" once published */
  published?: string;
}

export type LocalSummary = Omit<LocalSite, "files">;

const store = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-sites", "sites");

export const ZOLA_FOR_NEW_SITES = "0.23.6";

export async function listLocalSites(): Promise<LocalSummary[]> {
  if (!store) return [];
  const all = await entries<string, LocalSite>(store);
  return all.map(([, site]) => {
    const { files: _files, ...summary } = site;
    return summary;
  }).sort((a, b) => b.created - a.created);
}

export async function getLocalSite(id: string): Promise<LocalSite | undefined> {
  return store ? get<LocalSite>(id, store) : undefined;
}

export async function deleteLocalSite(id: string): Promise<void> {
  if (store) await del(id, store);
}

export async function markPublished(id: string, fullName: string): Promise<void> {
  const site = await getLocalSite(id);
  if (site && store) await set(id, { ...site, published: fullName }, store);
}

/** Download the theme, make a site with it that builds, and keep it in this browser */
export async function createLocalSite(theme: CatalogTheme, title: string, onProgress: (progress: Progress | { stage: "building" }) => void): Promise<LocalSite> {
  const files = await downloadTheme(theme, onProgress);
  onProgress({ stage: "building" });
  const zola = new ZolaClient(`v${ZOLA_FOR_NEW_SITES}`, new Map());
  try {
    await zola.whenReady();
    const options = { themeName: theme.id, title, zolaVersion: ZOLA_FOR_NEW_SITES };
    const prepared = await prepareSite(files, options, async (site) => zola.build(new Map(site), `${location.origin}/site`));
    if (prepared.error) throw new Error(`${theme.name} doesn't build here:\n${prepared.error}`);
    const site: LocalSite = {
      id: crypto.randomUUID(),
      title,
      themeDir: theme.id,
      themeName: theme.name,
      themeRepo: theme.repo,
      themeCommit: theme.commit,
      created: Date.now(),
      files: prepared.files,
      dropped: prepared.dropped,
      starter: prepared.starter,
    };
    if (store) await set(site.id, site, store);
    return site;
  } finally {
    zola.dispose();
  }
}

/** A local site as the loader would give a repository */
export function localRepo(site: LocalSite): LoadedRepo {
  const fullName = `local:${site.id}`;
  const themePrefix = `themes/${site.themeDir}/`;
  return {
    owner: "local",
    repo: site.title,
    fullName,
    private: false,
    ref: "local",
    commit: "",
    entries: [...site.files].map(([path, data]) => {
      const theme = path.startsWith(themePrefix);
      return {
        path,
        sha: "",
        size: data.length,
        source: theme ? site.themeRepo : fullName,
        commit: theme ? site.themeCommit : "",
        sourcePath: theme ? path.slice(themePrefix.length) : path,
      };
    }),
    files: new Map(site.files),
    submodules: new Map([[`themes/${site.themeDir}`, { source: site.themeRepo, commit: site.themeCommit }]]),
    local: site.id,
  };
}
