import { describe, expect, it } from "vitest";
import { routeFromUrl, routePath, type Route } from "../src/shell/routes.ts";

const at = (path: string) => routeFromUrl(new URL(path, "https://zdrafts.example"));

describe("routes", () => {
  it("reads each screen's path", () => {
    expect(at("/")).toEqual({ kind: "home" });
    expect(at("/new")).toEqual({ kind: "new" });
    expect(at("/local/abc123")).toEqual({ kind: "local", id: "abc123" });
    expect(at("/gthmchttr/gthmchttr.com")).toEqual({ kind: "repo", ref: { owner: "gthmchttr", repo: "gthmchttr.com" } });
    expect(at("/gthmchttr/gthmchttr.com/")).toEqual({ kind: "repo", ref: { owner: "gthmchttr", repo: "gthmchttr.com" } });
    expect(at("/a/b/tree/feature/x")).toEqual({ kind: "repo", ref: { owner: "a", repo: "b", ref: "feature/x" } });
  });

  it("still opens the old query URLs", () => {
    expect(at("/?repo=a/b@dev")).toEqual({ kind: "repo", ref: { owner: "a", repo: "b", ref: "dev" } });
    expect(at("/?local=abc")).toEqual({ kind: "local", id: "abc" });
  });

  it("doesn't take the build's own paths for repositories", () => {
    expect(at("/site/posts")).toEqual({ kind: "home" });
    expect(at("/view/posts")).toEqual({ kind: "home" });
    expect(at("/a/b/blob/main")).toEqual({ kind: "home" });
  });

  it("round-trips", () => {
    const routes: Route[] = [
      { kind: "home" },
      { kind: "new" },
      { kind: "local", id: "x y" },
      { kind: "repo", ref: { owner: "gthmchttr", repo: "gthmchttr.com" } },
      { kind: "repo", ref: { owner: "a", repo: "b", ref: "feature/x" } },
      { kind: "repo", ref: { owner: "view", repo: "b" } },
    ];
    for (const route of routes) expect(at(routePath(route))).toEqual(route);
  });
});
