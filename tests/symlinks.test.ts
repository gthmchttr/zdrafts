import { zipSync } from "fflate";
import { expect, test } from "vitest";
import { resolveSymlinks, zipSymlinks } from "../src/repo/symlinks.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("links become copies of files and folders they point at", () => {
  const files = new Map(
    Object.entries({
      "content/_index.md": "home",
      "content/_index.fr.md": "_index.md",
      "content/blog/_index.fr.md": "../_index.fr.md",
      "static/shared/a.css": "a",
      "static/alias": "shared",
      "outside": "../../etc/passwd",
    }).map(([k, v]) => [k, encoder.encode(v)]),
  );
  resolveSymlinks(files, ["content/_index.fr.md", "content/blog/_index.fr.md", "static/alias", "outside"]);
  const text = (path: string) => (files.has(path) ? decoder.decode(files.get(path)) : undefined);
  expect(text("content/_index.fr.md")).toBe("home");
  expect(text("content/blog/_index.fr.md")).toBe("home");
  expect(text("static/alias/a.css")).toBe("a");
  expect(files.has("static/alias")).toBe(false);
  expect(files.has("outside")).toBe(false);
});

test("zip archives mark links in their attributes", () => {
  const zip = zipSync({
    "repo/a.md": [encoder.encode("text"), { os: 3, attrs: (0o100644 << 16) >>> 0 }],
    "repo/b.md": [encoder.encode("a.md"), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
  });
  expect([...zipSymlinks(zip)]).toEqual(["repo/b.md"]);
});
