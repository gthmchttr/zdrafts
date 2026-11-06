// GitHub as the app sees it, answered from fixture checkouts (npm run fixtures): the catalog's
// themes at their commits. Tests then don't depend on GitHub, or its rate limit.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { CATALOG } from "../../src/themes/catalog.ts";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

/** "owner/repo" → its checkout */
const repositories = new Map(CATALOG.map((theme) => [new URL(theme.repo).pathname.slice(1).toLowerCase(), join(FIXTURES, "themes", theme.id)]));

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, ...args], { maxBuffer: 1 << 28 }).toString();

const trees = new Map<string, unknown>();

/** A commit's tree as GitHub's trees API gives it */
function tree(dir: string, sha: string) {
  if (!trees.has(sha)) {
    const entries = git(dir, "ls-tree", "-r", "-l", sha)
      .trim()
      .split("\n")
      .map((line) => {
        const [meta, path] = line.split("\t");
        const [mode, type, objectSha, size] = meta.split(/\s+/);
        return { path, mode, type, sha: objectSha, ...(type === "blob" ? { size: Number(size) } : {}) };
      });
    trees.set(sha, { sha, tree: entries, truncated: false });
  }
  return trees.get(sha);
}

const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "etag" };

export async function mockGitHub(context: BrowserContext) {
  // Nothing from other sites (themes' fonts and scripts from CDNs): tests don't depend on the
  // network, and the pages they compare are served from here
  await context.route(
    (url) => !["localhost", "127.0.0.1", "api.github.com", "raw.githubusercontent.com"].includes(url.hostname),
    (route) => route.abort(),
  );
  // Chromium under Playwright doesn't route URLs ending in favicon.ico: a query makes them routable
  await context.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => original(typeof input === "string" && input.endsWith("favicon.ico") ? `${input}?` : input, init);
  });
  await context.route("https://api.github.com/**", (route) => {
    const match = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/.exec(new URL(route.request().url()).pathname);
    const name = match?.[1].toLowerCase();
    const dir = name && repositories.get(name);
    const rest = match?.[2] ?? "";
    if (!dir) return route.fulfill({ status: 404, headers: CORS, body: '{"message":"Not Found"}' });
    if (!rest) return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, json: { full_name: match![1], default_branch: "main", private: false } });
    if (rest.startsWith("/commits/")) return route.fulfill({ headers: CORS, body: git(dir, "rev-parse", "HEAD").trim() });
    const commit = /^\/git\/trees\/([0-9a-f]+)/.exec(rest)?.[1];
    if (commit) return route.fulfill({ headers: { ...CORS, "content-type": "application/json" }, json: tree(dir, commit) });
    return route.fulfill({ status: 404, headers: CORS, body: '{"message":"Not Found"}' });
  });
  await context.route("https://raw.githubusercontent.com/**", (route) => {
    const [owner, repo, , ...path] = new URL(route.request().url()).pathname.slice(1).split("/").map(decodeURIComponent);
    const dir = repositories.get(`${owner}/${repo}`.toLowerCase());
    try {
      return route.fulfill({ headers: CORS, body: readFileSync(join(dir!, ...path)) });
    } catch {
      return route.fulfill({ status: 404, headers: CORS, body: "404" });
    }
  });
}
