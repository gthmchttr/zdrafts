// Downloading a catalog theme for a new site, from GitHub or another host.
import { downloadGitHub, type Progress } from "../repo/github.ts";
import { downloadArchive, parseRemote } from "../repo/hosts.ts";
import type { CatalogTheme } from "../themes/catalog.ts";

export async function downloadTheme(theme: CatalogTheme, onProgress: (progress: Progress) => void): Promise<Map<string, Uint8Array>> {
  const remote = parseRemote(theme.repo);
  if (!remote) throw new Error(`Can't download ${theme.repo}`);
  onProgress({ stage: "listing", detail: `Downloading ${theme.name} from ${new URL(remote.origin).hostname}` });
  return remote.host === "github" ? downloadGitHub(remote.path, theme.commit, onProgress) : downloadArchive(remote, theme.commit);
}
