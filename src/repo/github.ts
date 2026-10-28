// Load a public GitHub repository into memory, theme submodules included.
//
// Browsers can't download GitHub's archives (codeload only allows GitHub's own origin), so this
// lists files with the Git Trees API (CORS-enabled, 60 requests/hour unauthenticated: ~3 per
// load) and downloads each from raw.githubusercontent.com (CORS-enabled, not rate-limited).
// Files are cached in IndexedDB by git blob SHA and trees by commit, so a reload only asks GitHub
// for the branch's latest commit and downloads what changed.
import { createStore, entries as storeEntries, get, getMany, set, setMany } from "idb-keyval";
import { downloadArchive, parseRemote, type Remote } from "./hosts.ts";
import { resolveSymlinks } from "./symlinks.ts";
import { getToken } from "./token.ts";

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
  /** "owner/repo" as GitHub spells it */
  fullName: string;
  private: boolean;
  ref: string;
  /** The commit loaded; moves forward when zdrafts commits */
  commit: string;
  entries: RepoEntry[];
  files: Map<string, Uint8Array>;
  /** Submodules, keyed by their path in the repository */
  submodules: Map<string, { source: string; commit: string }>;
  /** Set when GitHub couldn't be asked for the latest commit and the last one seen was used */
  stale?: string;
  /** A site made in this browser and not on GitHub (yet): its id in src/site/local.ts */
  local?: string;
}

export type Progress =
  | { stage: "listing"; detail: string }
  | { stage: "downloading"; done: number; total: number; bytes: number }
  | { stage: "done" };

/** What went wrong, so the UI can offer a token where one would help */
export type GitHubErrorKind = "rate-limit" | "not-found" | "unauthorized" | "forbidden" | "conflict" | "other";

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly kind: GitHubErrorKind = "other",
  ) {
    super(message);
  }
}

/** The branch and commit last loaded for a repository input, to fall back on */
interface Head {
  fullName: string;
  private: boolean;
  branch: string;
  commit: string;
  /** When GitHub last confirmed `commit` is the branch's latest (ms since epoch) */
  checkedAt?: number;
  /** GitHub's ETag for that answer, for a conditional request next time */
  etag?: string;
}

/**
 * Without a token every API request counts against 60 an hour, so a branch checked this recently
 * isn't asked about again. Commits made here update the remembered commit (rememberCommit), and
 * committing always checks the branch itself, so this never hides zdrafts' own work or overwrites
 * anyone's.
 */
const RECHECK_AFTER = 10 * 60 * 1000;

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
// Paths the site build never needs
const SKIP = /^(\.git|\.github\/|public\/|node_modules\/)|(^|\/)\.DS_Store$/;

const blobStore = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-blobs", "blobs");
const treeStore = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-trees", "trees");

/** "owner/repo", "owner/repo@ref" or a github.com URL (…/tree/<ref> included) */
export function parseRepoInput(input: string): RepoRef | null {
  const text = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/(.+))?$/.exec(text);
  if (url) return { owner: url[1], repo: url[2], ref: url[3] };
  const short = /^([\w.-]+)\/([\w.-]+)(?:@(.+))?$/.exec(text);
  if (short) return { owner: short[1], repo: short[2], ref: short[3] };
  return null;
}

/** A GitHub API request, with the user's token when there is one */
export async function githubFetch(path: string, init: RequestInit = {}, accept = "application/vnd.github+json"): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set("Accept", accept);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (token) headers.set("Authorization", `Bearer ${token.token}`);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  // 304: the conditional request's answer hasn't changed (free with a token)
  if (response.ok || response.status === 304) return response;

  const detail = await response
    .json()
    .then((body: { message?: string }) => body.message ?? "")
    .catch(() => "");
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
    const at = reset ? ` (resets at ${new Date(reset).toLocaleTimeString()})` : "";
    throw new GitHubError(
      token ? `GitHub's API limit for your token is used up${at}.` : `GitHub's limit for requests without a token is used up${at}.`,
      "rate-limit",
    );
  }
  if (response.status === 401) throw new GitHubError("GitHub didn't accept the token: it may have expired or been revoked.", "unauthorized");
  if (response.status === 404) {
    const repo = path.split("/").slice(2, 4).join("/");
    throw new GitHubError(
      token
        ? `Not found on GitHub: ${repo}. If it's private, the token needs access to it.`
        : `Not found on GitHub: ${repo}. If it's a private repository, add a GitHub token.`,
      "not-found",
    );
  }
  if (response.status === 403) throw new GitHubError(`GitHub refused: ${detail || "the token doesn't have permission for this"}.`, "forbidden");
  if (response.status === 409 || response.status === 422) throw new GitHubError(`GitHub: ${detail || `HTTP ${response.status}`}`, "conflict");
  throw new GitHubError(`GitHub API ${path}: HTTP ${response.status}${detail ? ` (${detail})` : ""}`);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return (await githubFetch(path, init)).json() as Promise<T>;
}

interface TreeResponse {
  sha: string;
  truncated: boolean;
  /** mode 120000: a symbolic link (the blob holds its target) */
  tree: { path: string; mode?: string; type: "blob" | "tree" | "commit"; sha: string; size?: number }[];
}

async function listTree(source: string, commit: string): Promise<TreeResponse["tree"]> {
  // A commit's tree never changes
  const key = `${source}@${commit}`;
  const cached = treeStore && (await get<TreeResponse["tree"]>(key, treeStore).catch(() => undefined));
  if (cached) return cached;
  const tree = await api<TreeResponse>(`/repos/${source}/git/trees/${commit}?recursive=1`);
  if (tree.truncated) throw new GitHubError(`${source} has too many files for GitHub's tree API`);
  if (treeStore) await set(key, tree.tree, treeStore).catch(() => {});
  return tree.tree;
}

/** The branch to load and its latest commit: one API call when the repository was loaded before */
async function resolveHead(ref: RepoRef): Promise<Head & { stale?: string }> {
  const name = `${ref.owner}/${ref.repo}`;
  const key = `head:${name}@${ref.ref ?? ""}`;
  const last = treeStore && (await get<Head>(key, treeStore).catch(() => undefined));
  const token = getToken();
  if (last && !token && last.checkedAt && Date.now() - last.checkedAt < RECHECK_AFTER) return last;
  try {
    // The default branch hardly ever changes, so it's looked up once
    const info = last && !ref.ref
      ? { full_name: last.fullName, default_branch: last.branch, private: last.private }
      : await api<{ default_branch: string; full_name: string; private: boolean }>(`/repos/${name}`);
    const branch = ref.ref ?? info.default_branch;
    // Just the SHA, conditionally: with a token, an unchanged branch costs no rate limit
    const same = last && last.fullName === info.full_name && last.branch === branch;
    const response = await githubFetch(
      `/repos/${info.full_name}/commits/${encodeURIComponent(branch)}`,
      { headers: same && last.etag ? { "If-None-Match": last.etag } : {} },
      "application/vnd.github.sha",
    );
    const commit = response.status === 304 && same ? last.commit : (await response.text()).trim();
    const head: Head = {
      fullName: info.full_name,
      private: info.private,
      branch,
      commit,
      checkedAt: Date.now(),
      etag: response.headers.get("etag") ?? (response.status === 304 ? last?.etag : undefined),
    };
    if (treeStore) await set(key, head, treeStore).catch(() => {});
    return head;
  } catch (error) {
    if (!(error instanceof GitHubError && error.kind === "rate-limit") || !last) throw error;
    return { ...last, stale: `${error.message} Showing ${last.branch} as last loaded (${last.commit.slice(0, 7)}).` };
  }
}

/**
 * Update what's remembered about a branch after committing to it (`commit`), or forget when it was
 * last checked (null), so the next load asks GitHub for its latest commit.
 */
export async function rememberCommit(fullName: string, branch: string, commit: string | null): Promise<void> {
  if (!treeStore) return;
  for (const [key, head] of await storeEntries<string, Head>(treeStore).catch(() => [] as [string, Head][])) {
    if (!key.startsWith("head:") || head.fullName.toLowerCase() !== fullName.toLowerCase() || head.branch !== branch) continue;
    const next = commit ? { ...head, commit, checkedAt: Date.now(), etag: undefined } : { ...head, checkedAt: undefined, etag: undefined };
    await set(key, next, treeStore).catch(() => {});
  }
}

/** Sources (owner/repo) whose files raw.githubusercontent.com can't serve: private repositories */
const privateSources = new Set<string>();

/**
 * A file's contents. Public files come from raw.githubusercontent.com; that doesn't accept tokens
 * from browsers (its CORS preflight refuses Authorization), so private ones come from the API.
 */
async function raw(source: string, commit: string, path: string, sha: string): Promise<Uint8Array> {
  const url = `${RAW}/${source}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
  for (let attempt = 0; ; attempt++) {
    try {
      if (privateSources.has(source)) {
        const response = await githubFetch(`/repos/${source}/git/blobs/${sha}`, {}, "application/vnd.github.raw");
        return new Uint8Array(await response.arrayBuffer());
      }
      const response = await fetch(url);
      // A private submodule: try again through the API
      if (response.status === 404 && getToken()) {
        privateSources.add(source);
        continue;
      }
      if (!response.ok) throw new GitHubError(`${source}/${path}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= 2 || (error instanceof GitHubError && error.kind !== "other")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

/** Submodule paths → where they come from, from .gitmodules */
export function parseGitmodules(text: string, owner: string): Map<string, Remote> {
  const out = new Map<string, Remote>();
  for (const section of text.split(/^\[submodule /m).slice(1)) {
    const path = /^\s*path\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
    let url = /^\s*url\s*=\s*(.+?)\s*$/m.exec(section)?.[1];
    // Relative to the repository itself: ../theme.git is a sibling on GitHub
    if (url?.startsWith("../")) url = `https://github.com/${owner}/${url.slice(3)}`;
    const remote = url ? parseRemote(url) : null;
    if (path && remote) out.set(path, remote);
  }
  return out;
}

export async function loadRepo(ref: RepoRef, onProgress: (progress: Progress) => void): Promise<LoadedRepo> {
  const name = `${ref.owner}/${ref.repo}`;
  onProgress({ stage: "listing", detail: `Looking up ${name}` });
  const head = await resolveHead(ref);
  const { fullName, branch, commit, stale } = head;
  if (head.private) privateSources.add(fullName);
  const info = { full_name: fullName };

  onProgress({ stage: "listing", detail: `Listing files in ${info.full_name}@${branch}` });
  const entries: RepoEntry[] = [];
  const submodules = new Map<string, { source: string; commit: string }>();
  const tree = await listTree(info.full_name, commit);
  const submoduleCommits = tree.filter((item) => item.type === "commit");
  const gitmodulesEntry = tree.find((item) => item.path === ".gitmodules");
  const gitmodules = submoduleCommits.length && gitmodulesEntry ? new TextDecoder().decode(await raw(info.full_name, commit, ".gitmodules", gitmodulesEntry.sha)) : "";
  const submoduleSources = parseGitmodules(gitmodules, ref.owner);
  // Submodules on other hosts (Codeberg, GitLab…) come as archives
  const archived = new Map<string, Uint8Array>();
  // Symbolic links, resolved once everything is downloaded
  const links: string[] = [];

  for (const item of tree) {
    if (item.type === "blob" && !SKIP.test(item.path)) {
      entries.push({ path: item.path, sha: item.sha, size: item.size ?? 0, source: info.full_name, commit, sourcePath: item.path });
      if (item.mode === "120000") links.push(item.path);
    }
  }
  for (const sub of submoduleCommits) {
    const remote = submoduleSources.get(sub.path);
    if (!remote) continue; // unknown host: the site will build without it, or report what's missing
    if (remote.host !== "github") {
      onProgress({ stage: "listing", detail: `Downloading ${remote.url} (${sub.path})` });
      submodules.set(sub.path, { source: remote.url, commit: sub.sha });
      for (const [path, data] of await downloadArchive(remote, sub.sha)) {
        if (SKIP.test(path)) continue;
        archived.set(`${sub.path}/${path}`, data);
        entries.push({ path: `${sub.path}/${path}`, sha: "", size: data.length, source: remote.url, commit: sub.sha, sourcePath: path });
      }
      continue;
    }
    const source = remote.path;
    onProgress({ stage: "listing", detail: `Listing ${source} (${sub.path})` });
    submodules.set(sub.path, { source, commit: sub.sha });
    for (const item of await listTree(source, sub.sha)) {
      if (item.type === "blob" && !SKIP.test(item.path)) {
        entries.push({ path: `${sub.path}/${item.path}`, sha: item.sha, size: item.size ?? 0, source, commit: sub.sha, sourcePath: item.path });
        if (item.mode === "120000") links.push(`${sub.path}/${item.path}`);
      }
    }
  }

  const files = await downloadEntries(entries.filter((entry) => !archived.has(entry.path)), onProgress);
  for (const [path, data] of archived) files.set(path, data);
  resolveSymlinks(files, links);
  onProgress({ stage: "done" });
  return { owner: ref.owner, repo: ref.repo, fullName, private: head.private, ref: branch, commit, entries, files, submodules, stale };
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
        const data = await raw(entry.source, entry.commit, entry.sourcePath, entry.sha);
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

/** All files of a GitHub repository at a commit (a theme for a new site) */
export async function downloadGitHub(source: string, commit: string, onProgress: (progress: Progress) => void): Promise<Map<string, Uint8Array>> {
  const entries: RepoEntry[] = [];
  const links: string[] = [];
  for (const item of await listTree(source, commit)) {
    if (item.type !== "blob" || SKIP.test(item.path)) continue;
    entries.push({ path: item.path, sha: item.sha, size: item.size ?? 0, source, commit, sourcePath: item.path });
    if (item.mode === "120000") links.push(item.path);
  }
  const files = await downloadEntries(entries, onProgress);
  resolveSymlinks(files, links);
  return files;
}
