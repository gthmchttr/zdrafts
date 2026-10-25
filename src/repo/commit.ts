// Commit edited files straight to a branch with GitHub's Git Data API: one tree, one commit, then
// a fast-forward of the branch. Nothing is force-pushed.
import { api, GitHubError } from "./github.ts";

export interface CommitRequest {
  /** "owner/repo" */
  fullName: string;
  branch: string;
  /** The commit the edits were made on */
  base: string;
  /** Path → new contents: text, or bytes for binary files (images) */
  files: Map<string, string | Uint8Array>;
  message: string;
}

/**
 * Commit `files` on top of the branch. If the branch moved on since `base`, the commit still goes
 * on top of it, unless one of the moved-on commits changed a file that's being committed: then
 * nothing is written, so no one's work is overwritten.
 */
export async function commitFiles(request: CommitRequest): Promise<string> {
  const { fullName, branch, base, files, message } = request;
  const ref = `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`;
  const head = (await api<{ object: { sha: string } }>(ref.replace("/refs/", "/ref/"))).object.sha;

  if (head !== base) {
    const compare = await api<{ status: string; files?: { filename: string; previous_filename?: string }[] }>(
      `/repos/${fullName}/compare/${base}...${head}`,
    );
    const changed = new Set((compare.files ?? []).flatMap((file) => [file.filename, file.previous_filename ?? ""]));
    const clashes = [...files.keys()].filter((path) => changed.has(path));
    if (compare.status !== "ahead" || clashes.length) {
      throw new GitHubError(
        clashes.length
          ? `${branch} has newer commits that also change ${clashes.join(", ")}. Download your changes, reopen the site to get the latest version, and apply them again.`
          : `${branch} no longer contains the commit these edits were made on. Reopen the site to get the latest version.`,
        "conflict",
      );
    }
  }

  const parent = await api<{ tree: { sha: string } }>(`/repos/${fullName}/git/commits/${head}`);
  // Text goes into the tree directly; binary files are uploaded as blobs first
  const entries = [];
  for (const [path, content] of files) {
    if (typeof content === "string") entries.push({ path, mode: "100644", type: "blob", content });
    else {
      const blob = await api<{ sha: string }>(`/repos/${fullName}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: base64(content), encoding: "base64" }),
      });
      entries.push({ path, mode: "100644", type: "blob", sha: blob.sha });
    }
  }
  const tree = await api<{ sha: string }>(`/repos/${fullName}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }),
  });
  const commit = await api<{ sha: string }>(`/repos/${fullName}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [head] }),
  });
  await api(ref, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return commit.sha;
}

function base64(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(binary);
}
