import { describe, expect, test } from "vitest";
import { failingContent, setTitle, setTomlKey, siteFromTheme } from "../src/site/newsite.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("config edits", () => {
  test("replace a top-level key, keeping comments and tables", () => {
    const toml = '# my site\nbase_url = "https://a.org"\ntitle = "Old"\n\n[extra]\ntitle = "inner"\n';
    expect(setTomlKey(toml, "title", "New")).toBe('# my site\nbase_url = "https://a.org"\ntitle = "New"\n\n[extra]\ntitle = "inner"\n');
  });

  test("add a missing key before the first table", () => {
    expect(setTomlKey('base_url = "x"\n\n[extra]\na = 1\n', "theme", "t")).toBe('base_url = "x"\ntheme = "t"\n\n[extra]\na = 1\n');
    expect(setTomlKey("[extra]\na = 1\n", "theme", "t")).toBe('theme = "t"\n[extra]\na = 1\n');
    expect(setTomlKey("", "minify_html", false)).toBe("minify_html = false\n");
  });

  test("CRLF files stay CRLF", () => {
    expect(setTomlKey('base_url = "x"\r\n[extra]\r\n', "title", "T")).toBe('base_url = "x"\r\ntitle = "T"\r\n[extra]\r\n');
    expect(setTomlKey('title = "a"\r\n', "title", "b")).toBe('title = "b"\r\n');
  });

  test("the title goes where the config keeps it", () => {
    expect(setTitle('title = "a"\n', "B")).toBe('title = "B"\n');
    const languages = 'default_language = "en"\n\n[languages.en]\ntitle = "Old"\n\n[languages.fr]\ntitle = "Vieux"\n';
    expect(setTitle(languages, "New")).toBe('default_language = "en"\n\n[languages.en]\ntitle = "New"\n\n[languages.fr]\ntitle = "Vieux"\n');
    expect(setTitle('base_url = "x"\n', "T")).toBe('base_url = "x"\ntitle = "T"\n');
  });
});

test("failing demo pages are found in Zola's errors", () => {
  expect(failingContent(["Building site...", "ERROR Failed to render page content of '/site/content/pages/cv.md'"])).toBe("content/pages/cv.md");
  expect(failingContent(["ERROR Failed to render page '/site/content/posts/a.md'"])).toBe("content/posts/a.md");
  expect(failingContent(["ERROR I/O error"])).toBeNull();
});

test("a new site mirrors the theme's demo site", () => {
  const theme = new Map(
    Object.entries({
      "theme.toml": 'name = "t"',
      "config.toml": 'base_url = "https://demo"\ntitle = "Demo"\n',
      "templates/index.html": "x",
      "static/icons/a.svg": "<svg/>",
      "data/cv.yml": "a: 1",
      "content/_index.md": "+++\n+++\n",
      "docs/guide.md": "no",
      ".github/workflows/ci.yml": "no",
    }).map(([k, v]) => [k, encoder.encode(v)]),
  );
  const site = siteFromTheme(theme, { themeName: "t", title: "Mine", zolaVersion: "0.23.6" });
  expect([...site.keys()].sort()).toEqual([
    ".github/workflows/deploy.yml",
    ".gitignore",
    "content/_index.md",
    "data/cv.yml",
    "static/icons/a.svg",
    "themes/t/config.toml",
    "themes/t/content/_index.md",
    "themes/t/data/cv.yml",
    "themes/t/docs/guide.md",
    "themes/t/static/icons/a.svg",
    "themes/t/templates/index.html",
    "themes/t/theme.toml",
    "zola.toml",
  ]);
  expect(decoder.decode(site.get("zola.toml"))).toBe('base_url = "https://example.com"\ntitle = "Mine"\ntheme = "t"\n');
});

test("a starter page uses a template that shows its content", async () => {
  const { contentTemplate } = await import("../src/site/newsite.ts");
  const theme = (files: Record<string, string>) => new Map(Object.entries(files).map(([k, v]) => [k, encoder.encode(v)]));
  expect(contentTemplate(theme({ "templates/page.html": "{{ page.content | safe }}" }))).toBe("page.html");
  expect(contentTemplate(theme({ "templates/page.html": "{{ page.title }}", "templates/post.html": "<article>{{ page.content | safe }}</article>", "templates/base.html": "{{ page.content }}" }))).toBe("post.html");
  expect(contentTemplate(theme({ "templates/index.html": "x" }))).toBeNull();
  const site = siteFromTheme(theme({ "templates/post.html": "{{ page.content }}" }), { themeName: "t", title: "Mine", zolaVersion: "0.23.6" });
  expect(decoder.decode(site.get("content/_index.md"))).toBe('+++\ntitle = "Mine"\npage_template = "post.html"\nsort_by = "date"\n+++\n');
});
