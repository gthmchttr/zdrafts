// Load a public GitHub repository into memory, theme submodules included.
//
// Browsers can't download GitHub's archives (codeload only allows GitHub's own origin), so this
// lists files with the Git Trees API (CORS-enabled, 60 requests/hour unauthenticated: ~3 per
// load) and downloads each from raw.githubusercontent.com (CORS-enabled, not rate-limited).
// Files are cached in IndexedDB by git blob SHA, so a reload only downloads what changed.
import { createStore, getMany, setMany } from "idb-keyval";

export interface RepoRef {
  owner: string;
  repo: string;
  /** Branch, tag or commit; the default branch when missing */
  ref?: string;
}

export interface RepoEntry {
  path: string;
  sha: string;
  size: number;
  /** "owner/repo" the file comes from (differs from the site's for submodule files) */
  source: string;
  commit: string;
  /** Path inside `source` */
  sourcePath: string;
}

export interface LoadedRepo {
  owner: string;
  repo: string;
  ref: string;
  commit: string;
  entries: RepoEntry[];
  files: Map<string, Uint8Array>;
  /** Submodules, keyed by their path in the repository */
  submodules: Map<string, { source: string; commit: string }>;
}

export type Progress =
  | { stage: "listing"; detail: string }
  | { stage: "downloading"; done: number; total: number; bytes: number }
  | { stage: "done" };

export class GitHubError extends Error {}

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
// Paths the site build never needs
const SKIP = /^(\.git|\.github\/|public\/|node_modules\/)|(^|\/)\.DS_Store$/;

const blobStore = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-blobs", "blobs");

/** "owner/repo", "owner/repo@ref" or a github.com URL (…/tree/<ref> included) */
export function parseRepoInput(input: string): RepoRef | null {
  const text = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/(.+))?$/.exec(text);
  if (url) return { owner: url[1], repo: url[2], ref: url[3] };
  const short = /^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/.exec(text);
  if (short) return { owner: short[1], repo: short[2], ref: short[3] };
  return null;
}

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Accept: "application/vnd.github+json" } });
  if (response.ok) return response.json() as Promise<T>;
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const at = reset ? ` (resets at ${new Date(reset).toLocaleTimeString()})` : "";
    throw new GitHubError(`GitHub's API limit for unauthenticated requests is used up${at}. Try again later.`);
  }
  if (response.status === 404) throw new GitHubError(`Not found on GitHub: ${path.split("/").slice(2, 4).join("/")} (only public repositories can be opened)`);
  throw new GitHubError(`GitHub API ${path}: HTTP ${response.status}`);
}

interface TreeResponse {
  sha: string;
  truncated: boolean;
  tree: { path: string; type: "blob" | "tree" | "commit"; sha: string; size?: number }[];
}

async function listTree(source: string, commit: string) {
  const tree = await api<TreeResponse>(`/repos/${source}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new GitHubError(`${source} has too many files for GitHub's tree API`);
  return tree.tree;
}

async function raw(source: string, commit: string, path: string): Promise<Uint8Array> {
  const url = `${RAW}/${source}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new GitHubError(`${source}/${path}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

/** Submodule paths → GitHub "owner/repo", from .gitmodules */
function parseGitmodules(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of text.split(/^\[submodule /m).slice(1)) {
    const path = /^\s*path\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
    const url = /^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
    const github = url && /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url);
    if (path && github) out.set(path, `${github[1]}/${github[2]}`);
  }
  return out;
}

export async function loadRepo(ref: RepoRef, onProgress: (progress: Progress) => void): Promise<LoadedRepo> {
  const name = `${ref.owner}/${ref.repo}`;
  onProgress({ stage: "listing", detail: `Looking up ${name}` });
  const info = await api<{ default_branch: string; full_name: string }>(`/repos/${name}`);
  const branch = ref.ref ?? info.default_branch;
  const { sha: commit } = await api<{ sha: string }>(`/repos/${info.full_name}/commits/${encodeURIComponent(branch)}`);

  onProgress({ stage: "listing", detail: `Listing files in ${info.full_name}@${branch}` });
  const entries: RepoEntry[] = [];
  const submodules = new Map<string, { source: string; commit: string }>();
  const tree = await listTree(info.full_name, commit);
  const submoduleCommits = tree.filter((item) => item.type === "commit");
  const gitmodules = submoduleCommits.length ? new TextDecoder().decode(await raw(info.full_name, commit, ".gitmodules")) : "";
  const submoduleSources = parseGitmodules(gitmodules);

  for (const item of tree) {
    if (item.type === "blob" && !SKIP.test(item.path)) {
      entries.push({ path: item.path, sha: item.sha, size: item.size ?? 0, source: info.full_name, commit, sourcePath: item.path });
    }
  }
  for (const sub of submoduleCommits) {
    const source = submoduleSources.get(sub.path);
    if (!source) continue; // not on GitHub: the site will build without it, or report what's missing
    onProgress({ stage: "listing", detail: `Listing ${source} (${sub.path})` });
    submodules.set(sub.path, { source, commit: sub.sha });
    for (const item of await listTree(source, sub.sha)) {
      if (item.type === "blob" && !SKIP.test(item.path)) {
        entries.push({ path: `${sub.path}/${item.path}`, sha: item.sha, size: item.size ?? 0, source, commit: sub.sha, sourcePath: item.path });
      }
    }
  }

  const files = await downloadEntries(entries, onProgress);
  onProgress({ stage: "done" });
  return { owner: ref.owner, repo: ref.repo, ref: branch, commit, entries, files, submodules };
}

async function downloadEntries(entries: RepoEntry[], onProgress: (progress: Progress) => void) {
  const files = new Map<string, Uint8Array>();
  const cached = blobStore ? await getMany<Uint8Array | undefined>(entries.map((e) => e.sha), blobStore) : [];
  const missing: RepoEntry[] = [];
  entries.forEach((entry, i) => {
    const hit = cached[i];
    if (hit) files.set(entry.path, hit);
    else missing.push(entry);
  });

  let done = entries.length - missing.length;
  let bytes = 0;
  const fresh: [string, Uint8Array][] = [];
  const report = () => onProgress({ stage: "downloading", done, total: entries.length, bytes });
  report();
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: Math.min(24, queue.length) }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        const data = await raw(entry.source, entry.commit, entry.sourcePath);
        files.set(entry.path, data);
        fresh.push([entry.sha, data]);
        done++;
        bytes += data.length;
        if (done % 20 === 0 || done === entries.length) report();
      }
    }),
  );
  if (blobStore && fresh.length) await setMany(fresh, blobStore).catch(() => {});
  return files;
}
