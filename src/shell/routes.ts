// The app's URLs: each screen has its own path, so sites can be linked to and Back works.
//   /                              start screen
//   /new                           start a new site with a theme
//   /local/<id>                    a site made in this browser
//   /<owner>/<repo>                a GitHub repository, its default branch
//   /<owner>/<repo>/tree/<branch>  …a branch (as on github.com; branches can contain slashes)
// The old ?repo=owner/name[@branch] and ?local=<id> still open.
import { parseRepoInput, type RepoRef } from "../repo/github.ts";

export type Route = { kind: "home" } | { kind: "new" } | { kind: "local"; id: string } | { kind: "repo"; ref: RepoRef };

/**
 * First path segments that aren't owners: the service worker's /site/ and /view/, the build's
 * files. A GitHub owner with one of these names opens with ?repo= instead.
 */
const RESERVED = new Set(["new", "local", "site", "view", "assets", "zola"]);

const NAME = /^[\w.-]+$/;

export function routeFromUrl(url: URL): Route {
  const repo = url.searchParams.get("repo");
  const ref = repo ? parseRepoInput(repo) : null;
  if (ref) return { kind: "repo", ref };
  const local = url.searchParams.get("local");
  if (local) return { kind: "local", id: local };

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 1 && parts[0] === "new") return { kind: "new" };
  if (parts.length === 2 && parts[0] === "local") return { kind: "local", id: parts[1] };
  const [owner, name, tree, ...branch] = parts;
  if (owner && name && !RESERVED.has(owner) && NAME.test(owner) && NAME.test(name)) {
    const repoName = name.replace(/\.git$/, "");
    if (parts.length === 2) return { kind: "repo", ref: { owner, repo: repoName } };
    if (tree === "tree" && branch.length) return { kind: "repo", ref: { owner, repo: repoName, ref: branch.join("/") } };
  }
  return { kind: "home" };
}

export function routePath(route: Route): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "new":
      return "/new";
    case "local":
      return `/local/${encodeURIComponent(route.id)}`;
    case "repo": {
      const { owner, repo, ref } = route.ref;
      if (RESERVED.has(owner)) return `/?repo=${encodeURIComponent(`${owner}/${repo}${ref ? `@${ref}` : ""}`)}`;
      return `/${owner}/${repo}${ref ? `/tree/${ref.split("/").map(encodeURIComponent).join("/")}` : ""}`;
    }
  }
}
