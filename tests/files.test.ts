import { expect, test } from "vitest";
import { canMoveInto, newPageText, rewriteLinks, slugify } from "../src/shell/files.ts";

test("slugs", () => {
  expect(slugify("My first post!")).toBe("my-first-post");
  expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
  expect(slugify("  ")).toBe("untitled");
});

test("new pages in the site's front matter format", () => {
  const date = new Date("2026-10-25T10:00:00Z");
  expect(newPageText("Hi", "page", "toml", date)).toBe('+++\ntitle = "Hi"\ndate = 2026-10-25\n+++\n\n');
  expect(newPageText("Blog", "section", "yaml", date)).toBe('---\ntitle: "Blog"\n---\n\n');
});

test("links follow a moved page", () => {
  const text = "See [a](@/blog/a.md), [a#x](@/blog/a.md#x) and [ab](@/blog/ab.md).";
  expect(rewriteLinks(text, "content/blog/a.md", "content/notes/a.md")).toBe("See [a](@/notes/a.md), [a#x](@/notes/a.md#x) and [ab](@/blog/ab.md).");
});

test("links follow a moved static file, wherever they're written", () => {
  const text = '![x](/img/a.png) <img src="/img/a.png"> {{ <img src="/img/a.png" /> }} /img/a.png.bak (/img/a.pngx)';
  expect(rewriteLinks(text, "static/img/a.png", "static/pics/a.png")).toBe('![x](/pics/a.png) <img src="/pics/a.png"> {{ <img src="/pics/a.png" /> }} /img/a.png.bak (/img/a.pngx)');
});

test("where files may go", () => {
  expect(canMoveInto("content/a.md", "content/blog")).toBe(true);
  expect(canMoveInto("content/a.md", "static/img")).toBe(false);
  expect(canMoveInto("content/a.md", "content")).toBe(false);
  expect(canMoveInto("static/a.png", "content/blog")).toBe(true);
});
