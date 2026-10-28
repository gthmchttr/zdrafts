import { expect, test } from "vitest";
import { probeContext } from "../src/zola/probecontext.ts";

const site: Record<string, string> = {
  "content/_index.md": '+++\npage_template = "post.html"\n+++\n',
  "content/blog/_index.md": '+++\npage_template = "blog-post.html"\n+++\n',
  "content/blog/a.md": '+++\ntitle = "A"\n[extra]\nbanner = "x.png"\n+++\nBody',
  "content/blog/own.md": '+++\ntitle = "Own"\ntemplate = "special.html"\n+++\n',
  "content/notes/b.md": "---\ntitle: B\n---\n",
  "content/notes/yaml.md": "---\ntitle: Y\ntemplate: yaml.html\n---\n",
  "content/blog/bundle/index.md": '+++\ntitle = "Bundle"\n+++\n',
  "content/blog/bundle/photo.jpg": "",
  "content/blog/bundle/img/b.png": "",
};
const text = (path: string) => site[path];
const files = Object.keys(site);

test("the page's template, or the closest section's page_template", () => {
  expect(probeContext("content/blog/own.md", text, files).frontMatter).toContain('template = "special.html"');
  expect(probeContext("content/blog/a.md", text, files).frontMatter).toContain('template = "blog-post.html"');
  // YAML pages give YAML front matter
  expect(probeContext("content/notes/b.md", text, files).frontMatter).toContain('template: "post.html"');
  expect(probeContext("content/notes/yaml.md", text, files).frontMatter).toContain("template: yaml.html");
  // A section's content is probed as a page of that section
  expect(probeContext("content/blog/_index.md", text, files).frontMatter).toContain('template = "blog-post.html"');
});

test("the page's front matter goes along, without what gives it a URL or lists it", () => {
  site["content/blog/d.md"] = '+++\ntitle = "D"\ndate = 2026-01-02\npath = "/d/"\naliases = ["/old/"]\n[taxonomies]\ntags = ["x"]\n[extra]\nbanner = "x.png"\n+++\n';
  const toml = probeContext("content/blog/d.md", text, Object.keys(site)).frontMatter;
  expect(toml).toContain("date = 2026-01-02");
  expect(toml).toMatch(/\[extra\]\nbanner = "x.png"/);
  expect(toml).not.toMatch(/path|aliases|taxonomies|tags|title = "D"/);
  site["content/notes/y2.md"] = "---\ntitle: Y2\ndate: 2026-01-02\nslug: why\ntaxonomies:\n  tags:\n    - a\nextra:\n  x: 1\n---\n";
  const yaml = probeContext("content/notes/y2.md", text, Object.keys(site)).frontMatter;
  expect(yaml).toBe('---\ntitle: "zdrafts probe"\ndate: 2026-01-02\nextra:\n  x: 1\ntemplate: "post.html"\n---\n');
  const context = probeContext("content/blog/a.md", text, files);
  expect(context.frontMatter).toMatch(/\[extra\]\nbanner = "x.png"/);
  expect(context.id).not.toBe(probeContext("content/blog/own.md", text, files).id);
});

test("a page bundle's files go along", () => {
  const context = probeContext("content/blog/bundle/index.md", text, files);
  expect([...context.assets]).toEqual([
    ["photo.jpg", "content/blog/bundle/photo.jpg"],
    ["img/b.png", "content/blog/bundle/img/b.png"],
  ]);
  expect(probeContext("content/blog/a.md", text, files).assets.size).toBe(0);
});

test("pages that render alike share a context", () => {
  site["content/blog/c.md"] = '+++\ntitle = "C"\n+++\n';
  expect(probeContext("content/blog/c.md", text, Object.keys(site)).id).toBe(probeContext("content/blog/c.md", text, Object.keys(site)).id);
  expect(probeContext("content/notes/b.md", text, files).id).not.toBe(probeContext("content/blog/c.md", text, Object.keys(site)).id);
});

test("sections and translations by file name", async () => {
  const { isSectionFile, isTranslation } = await import("../src/zola/probecontext.ts");
  expect(["content/_index.md", "content/blog/_index.de.md", "content/blog/post.md"].map(isSectionFile)).toEqual([true, true, false]);
  expect(["content/blog/post.fr.md", "content/blog/post.md", "content/blog/my.post.md", "content/_index.pt-br.md"].map(isTranslation)).toEqual([true, false, false, true]);
});
