// Git hosts besides GitHub, for themes (submodules, or a new site's theme). Their APIs allow
// browsers (CORS): Forgejo/Gitea give a repository at a commit as one archive, GitLab file by file. Self-hosted servers without
// CORS can't be reached from a browser; they're reported as such.
import { unzipSync } from "fflate";
import { createStore, get, set } from "idb-keyval";
import { resolveSymlinks, zipSymlinks } from "./symlinks.ts";

export interface Remote {
  host: "github" | "gitlab" | "gitea";
  /** e.g. https://codeberg.org */
  origin: string;
  /** owner/repo (GitLab: the project path, which may have groups) */
  path: string;
  /** For display and as a key: https://codeberg.org/owner/repo */
  url: string;
}

/** A git remote URL (https, ssh or scp-like) as a host we know how to download from */
export function parseRemote(url: string): Remote | null {
  const text = url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = /^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)[/:](.+)$/.exec(text);
  if (!match) return null;
  const [, domain, path] = match;
  if (!path.includes("/")) return null;
  const origin = `https://${domain}`;
  const host = domain === "github.com" ? "github" : domain === "gitlab.com" || domain.startsWith("gitlab.") ? "gitlab" : "gitea";
  return { host, origin, path, url: `${origin}/${path}` };
}

const archiveStore = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-archives", "archives");

export class HostError extends Error {}

function archiveUrl(remote: Remote, commit: string): string {
  // Forgejo and Gitea (Codeberg…)
  return `${remote.origin}/api/v1/repos/${remote.path}/archive/${commit}.zip`;
}

/** A repository's files at a commit, from its host's archive download (cached: a commit never changes) */
export async function downloadArchive(remote: Remote, commit: string): Promise<Map<string, Uint8Array>> {
  // v2: symbolic links resolved
  const key = `v2:${remote.url}@${commit}`;
  const cached = archiveStore && (await get<Map<string, Uint8Array>>(key, archiveStore).catch(() => undefined));
  if (cached) return cached;
  if (remote.host === "gitlab") {
    const files = await downloadGitLab(remote, commit);
    if (archiveStore) await set(key, files, archiveStore).catch(() => {});
    return files;
  }
  let response: Response;
  try {
    response = await fetch(archiveUrl(remote, commit));
  } catch {
    throw new HostError(`${remote.origin} doesn't let browsers download from it, so ${remote.path} can't be loaded here.`);
  }
  if (!response.ok) throw new HostError(`${remote.url}: download failed (HTTP ${response.status}).`);
  const zip = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(zip);
  const links = zipSymlinks(zip);
  // Archives put everything in one top folder (repo-commit/)
  const files = new Map<string, Uint8Array>();
  const linked: string[] = [];
  for (const [name, data] of Object.entries(entries)) {
    const slash = name.indexOf("/");
    const path = name.slice(slash + 1);
    if (!path || path.endsWith("/")) continue;
    files.set(path, data);
    if (links.has(name)) linked.push(path);
  }
  resolveSymlinks(files, linked);
  if (archiveStore) await set(key, files, archiveStore).catch(() => {});
  return files;
}

/** fetch, waiting and trying again while the server says it's getting too many requests (HTTP 429) */
async function patientFetch(url: string): Promise<Response | null> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url).catch(() => null);
    if (response?.status !== 429 || attempt >= 6) return response;
    const wait = Number(response.headers.get("retry-after")) || 2 ** attempt;
    // Not minutes: say how long instead
    if (wait > 60) throw new HostError(`${new URL(url).host} is limiting downloads from this network; try again in about ${Math.ceil(wait / 60)} minutes.`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

/**
 * GitLab refuses archive downloads to browsers (406), so: its file list, then each file. Both
 * allow browsers.
 */
async function downloadGitLab(remote: Remote, commit: string): Promise<Map<string, Uint8Array>> {
  const api = `${remote.origin}/api/v4/projects/${encodeURIComponent(remote.path)}/repository`;
  const blobs: { path: string; id: string; mode: string }[] = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const response = await patientFetch(`${api}/tree?recursive=true&per_page=100&ref=${commit}&page=${page}`);
    if (!response?.ok) throw new HostError(`${remote.url}: listing files failed${response ? ` (HTTP ${response.status})` : ""}.`);
    pages = Number(response.headers.get("x-total-pages") ?? "1") || 1;
    for (const item of (await response.json()) as { path: string; id: string; type: string; mode: string }[]) {
      if (item.type === "blob") blobs.push(item);
    }
  }
  const files = new Map<string, Uint8Array>();
  const queue = [...blobs];
  // Gently: GitLab limits how fast files can be fetched (HTTP 429), so few at a time, waiting when told to
  const download = async (blob: { path: string; id: string }) => {
    const response = await patientFetch(`${api}/blobs/${blob.id}/raw`);
    if (response?.ok) return new Uint8Array(await response.arrayBuffer());
    throw new HostError(`${remote.url}: downloading ${blob.path} failed${response ? ` (HTTP ${response.status})` : ""}.`);
  };
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let blob = queue.shift(); blob; blob = queue.shift()) files.set(blob.path, await download(blob));
    }),
  );
  resolveSymlinks(files, blobs.filter((blob) => blob.mode === "120000").map((blob) => blob.path));
  return files;
}

/** The latest commit of a branch (or the default branch) on a non-GitHub host */
export async function latestCommit(remote: Remote, branch?: string): Promise<string> {
  const api =
    remote.host === "gitlab"
      ? `${remote.origin}/api/v4/projects/${encodeURIComponent(remote.path)}/repository/commits/${encodeURIComponent(branch ?? "HEAD")}`
      : `${remote.origin}/api/v1/repos/${remote.path}/commits?limit=1${branch ? `&sha=${encodeURIComponent(branch)}` : ""}`;
  let response: Response;
  try {
    response = await fetch(api);
  } catch {
    throw new HostError(`${remote.origin} doesn't let browsers download from it, so ${remote.path} can't be loaded here.`);
  }
  if (!response.ok) throw new HostError(`${remote.url}: HTTP ${response.status}`);
  const body = await response.json();
  const sha = remote.host === "gitlab" ? body.id : body[0]?.sha;
  if (typeof sha !== "string") throw new HostError(`${remote.url}: no commits found`);
  return sha;
}
