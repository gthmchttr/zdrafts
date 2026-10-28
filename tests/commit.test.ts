import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { commitFiles } from "../src/repo/commit.ts";
import { GitHubError } from "../src/repo/github.ts";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  auth: string | null;
}

/** A tiny GitHub: the branch's head, what changed since `base`, and the requests made */
function fakeGitHub(options: { head: string; changedSinceBase?: string[]; status?: string }) {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path: url.pathname, body, auth: new Headers(init.headers).get("authorization") });
    const p = url.pathname;
    if (method === "GET" && p.endsWith("/git/ref/heads/main")) return json({ object: { sha: options.head } });
    if (method === "GET" && p.includes("/compare/"))
      return json({ status: options.status ?? "ahead", files: (options.changedSinceBase ?? []).map((filename) => ({ filename })) });
    if (method === "GET" && p.includes("/git/commits/")) return json({ tree: { sha: "tree-of-head" } });
    if (method === "POST" && p.endsWith("/git/blobs")) return json({ sha: "new-blob" }, 201);
    if (method === "POST" && p.endsWith("/git/trees")) return json({ sha: "new-tree" }, 201);
    if (method === "POST" && p.endsWith("/git/commits")) return json({ sha: "new-commit" }, 201);
    if (method === "PATCH" && p.endsWith("/git/refs/heads/main")) return json({ object: { sha: "new-commit" } });
    return json({ message: "Not Found" }, 404);
  });
  return calls;
}

const request = {
  fullName: "o/site",
  branch: "main",
  base: "base",
  files: new Map([["content/a.md", "# A\n"]]),
  message: "Update a.md",
};

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
  vi.stubGlobal("sessionStorage", localStorage);
  localStorage.setItem("zdrafts.github-token", JSON.stringify({ token: "t0ken", login: "me" }));
});
afterEach(() => vi.unstubAllGlobals());

describe("commitFiles", () => {
  test("commits on the loaded commit and fast-forwards the branch", async () => {
    const calls = fakeGitHub({ head: "base" });
    expect(await commitFiles(request)).toBe("new-commit");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /repos/o/site/git/ref/heads/main",
      "GET /repos/o/site/git/commits/base",
      "POST /repos/o/site/git/trees",
      "POST /repos/o/site/git/commits",
      "PATCH /repos/o/site/git/refs/heads/main",
    ]);
    expect(calls[2].body).toEqual({ base_tree: "tree-of-head", tree: [{ path: "content/a.md", mode: "100644", type: "blob", content: "# A\n" }] });
    expect(calls[3].body).toEqual({ message: "Update a.md", tree: "new-tree", parents: ["base"] });
    expect(calls[4].body).toEqual({ sha: "new-commit", force: false });
    expect(calls.every((c) => c.auth === "Bearer t0ken")).toBe(true);
  });

  test("goes on top of newer commits that changed other files", async () => {
    const calls = fakeGitHub({ head: "newer", changedSinceBase: ["content/b.md"] });
    await commitFiles(request);
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/git/commits"))!.body).toMatchObject({ parents: ["newer"] });
  });

  test("refuses when newer commits changed the same file", async () => {
    const calls = fakeGitHub({ head: "newer", changedSinceBase: ["content/a.md"] });
    const error = await commitFiles(request).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error.kind).toBe("conflict");
    expect(error.message).toContain("content/a.md");
    expect(calls.some((c) => c.method !== "GET")).toBe(false);
  });

  test("uploads binary files as blobs", async () => {
    const calls = fakeGitHub({ head: "base" });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    await commitFiles({ ...request, files: new Map<string, string | Uint8Array>([["static/images/a.png", png], ["content/a.md", "![a](/images/a.png)\n"]]) });
    const blob = calls.find((c) => c.path.endsWith("/git/blobs"))!;
    expect(blob.body).toEqual({ content: Buffer.from(png).toString("base64"), encoding: "base64" });
    expect(calls.find((c) => c.path.endsWith("/git/trees"))!.body).toEqual({
      base_tree: "tree-of-head",
      tree: [
        { path: "static/images/a.png", mode: "100644", type: "blob", sha: "new-blob" },
        { path: "content/a.md", mode: "100644", type: "blob", content: "![a](/images/a.png)\n" },
      ],
    });
  });

  test("deletes files given as null", async () => {
    const calls = fakeGitHub({ head: "base" });
    await commitFiles({ ...request, files: new Map<string, string | Uint8Array | null>([["content/old.md", null], ["content/new.md", "# New\n"]]) });
    expect(calls.find((c) => c.path.endsWith("/git/trees"))!.body).toEqual({
      base_tree: "tree-of-head",
      tree: [
        { path: "content/old.md", mode: "100644", type: "blob", sha: null },
        { path: "content/new.md", mode: "100644", type: "blob", content: "# New\n" },
      ],
    });
  });

  test("refuses when the branch was rewritten", async () => {
    fakeGitHub({ head: "other", status: "diverged" });
    await expect(commitFiles(request)).rejects.toMatchObject({ kind: "conflict" });
  });
});
