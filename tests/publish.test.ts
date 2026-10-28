import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CreateRepoError, publish } from "../src/site/publish.ts";

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

function fakeGitHub(options: { canCreate?: boolean; empty?: boolean; workflowScope?: boolean } = {}) {
  const calls: Call[] = [];
  let empty = options.empty ?? false;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (method === "POST" && p === "/user/repos") return options.canCreate === false ? json({ message: "Resource not accessible by personal access token" }, 403) : json({ full_name: "me/site" }, 201);
    if (method === "GET" && p === "/repos/me/site") return json({ default_branch: "main" });
    if (method === "GET" && p === "/repos/me/site/git/ref/heads/main") return empty ? json({ message: "Git Repository is empty." }, 409) : json({ object: { sha: "c0" } });
    if (method === "PUT" && p === "/repos/me/site/contents/README.md") { empty = false; return json({}, 201); }
    if (method === "GET" && p.startsWith("/repos/me/site/git/commits/")) return json({ tree: { sha: "t0" } });
    if (method === "POST" && p.endsWith("/git/blobs")) return json({ sha: "b1" }, 201);
    if (method === "POST" && p.endsWith("/git/trees")) return json({ sha: "t1" }, 201);
    if (method === "POST" && p.endsWith("/git/commits")) return json({ sha: "c1" }, 201);
    if (method === "PATCH" && p.endsWith("/git/refs/heads/main")) {
      const tree = calls.findLast((c) => c.path.endsWith("/git/trees"))!.body!.tree as { path: string }[];
      if (options.workflowScope === false && tree.some((e) => e.path.startsWith(".github/workflows/"))) return json({ message: "refusing to allow a Personal Access Token to create or update workflow `.github/workflows/deploy.yml` without `workflow` scope" }, 422);
      return json({ object: { sha: "c1" } });
    }
    if (method === "POST" && p === "/repos/me/site/pages") return json({}, 201);
    return json({ message: "Not Found" }, 404);
  });
  return calls;
}

const encoder = new TextEncoder();
const input = {
  title: "My site",
  files: new Map([
    ["zola.toml", encoder.encode('theme = "tabi"\n')],
    ["content/_index.md", encoder.encode("+++\n+++\n")],
    ["static/a.png", new Uint8Array([0x89, 0x50])],
    [".github/workflows/deploy.yml", encoder.encode("name: Deploy\n")],
  ]),
  themeDir: "tabi",
  themeRepo: "https://github.com/welpo/tabi",
  themeCommit: "f0cb3a67",
};
const target = { owner: "me", name: "site", private: false, existing: false };

beforeEach(() => {
  const store = new Map<string, string>([["zdrafts.github-token", JSON.stringify({ token: "t", login: "me" })]]);
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  vi.stubGlobal("sessionStorage", localStorage);
});
afterEach(() => vi.unstubAllGlobals());

test("creates the repository, commits the site with the theme as a submodule, and turns on Pages", async () => {
  const calls = fakeGitHub();
  const result = await publish(input, target, () => {});
  expect(result).toEqual({ fullName: "me/site", branch: "main", pages: true, withoutWorkflow: false });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/user/repos", body: { name: "site", private: false, auto_init: true } });
  const tree = calls.find((c) => c.path.endsWith("/git/trees"))!.body!;
  expect(tree.base_tree).toBe("t0");
  expect(tree.tree).toEqual(
    expect.arrayContaining([
      { path: "zola.toml", mode: "100644", type: "blob", content: 'theme = "tabi"\n' },
      { path: "static/a.png", mode: "100644", type: "blob", sha: "b1" },
      { path: ".gitmodules", mode: "100644", type: "blob", content: '[submodule "themes/tabi"]\n\tpath = themes/tabi\n\turl = https://github.com/welpo/tabi.git\n' },
      { path: "themes/tabi", mode: "160000", type: "commit", sha: "f0cb3a67" },
    ]),
  );
  expect(calls.some((c) => c.method === "POST" && c.path === "/repos/me/site/pages")).toBe(true);
});

test("without the workflow permission, publishes without the deploy workflow", async () => {
  fakeGitHub({ workflowScope: false });
  const result = await publish(input, target, () => {});
  expect(result.withoutWorkflow).toBe(true);
});

test("a token that can't create repositories: create it on GitHub", async () => {
  fakeGitHub({ canCreate: false });
  const error = await publish(input, target, () => {}).catch((e) => e);
  expect(error).toBeInstanceOf(CreateRepoError);
  expect(error.newRepoUrl).toBe("https://github.com/new?name=site&owner=me&visibility=public");
});

test("into an empty repository made by hand", async () => {
  const calls = fakeGitHub({ empty: true });
  await publish(input, { ...target, existing: true }, () => {});
  expect(calls.some((c) => c.method === "POST" && c.path === "/user/repos")).toBe(false);
  expect(calls.some((c) => c.method === "PUT" && c.path.endsWith("/contents/README.md"))).toBe(true);
  expect(calls.some((c) => c.method === "PATCH")).toBe(true);
});
