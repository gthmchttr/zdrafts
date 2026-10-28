// A new Zola site that uses a theme: the theme under themes/<name>/, the theme's demo config with
// `theme = "<name>"`, its demo content to start from, and a GitHub Pages workflow for later.

export interface NewSiteOptions {
  /** Directory under themes/ and the config's `theme` value */
  themeName: string;
  title: string;
  baseUrl?: string;
  zolaVersion: string;
  /** Start from the theme's demo content (default), or from a single starter page */
  content?: "demo" | "starter";
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Paths in a theme repository that belong to its own demo site or repository, not the theme */
const NOT_THEME = /^(\.git\/|\.github\/|public\/|node_modules\/)/;

/** Set a key in config text, keeping everything else (comments, line endings) as it was */
export function setTomlKey(toml: string, key: string, value: string | boolean): string {
  const eol = toml.includes("\r\n") ? "\r\n" : "\n";
  const line = `${key} = ${typeof value === "string" ? JSON.stringify(value) : String(value)}`;
  const existing = new RegExp(`^([ \\t]*)${key}[ \\t]*=[^\\r\\n]*`, "m");
  // Top level ends at the first table header
  const header = toml.search(/^[ \t]*\[/m);
  const top = header < 0 ? toml : toml.slice(0, header);
  const rest = header < 0 ? "" : toml.slice(header);
  if (existing.test(top)) return top.replace(existing, `$1${line}`) + rest;
  // After the last top-level line, keeping the blank lines before the first table
  const trimmed = top.replace(/\s+$/, "");
  const trailing = top.slice(trimmed.length);
  return `${trimmed}${trimmed ? eol : ""}${line}${trailing || eol}${rest}`;
}

/**
 * Set the site's title where the config keeps it: at the top level, or for the default language
 * in [languages.<lang>] (Zola refuses a title in both).
 */
export function setTitle(toml: string, title: string): string {
  const header = toml.search(/^[ \t]*\[/m);
  const top = header < 0 ? toml : toml.slice(0, header);
  if (/^[ \t]*title[ \t]*=/m.test(top)) return setTomlKey(toml, "title", title);
  const lang = /^[ \t]*default_language[ \t]*=[ \t]*"([^"]+)"/m.exec(top)?.[1] ?? "en";
  const table = new RegExp(`^[ \\t]*\\[languages\\.${lang}\\][^\\n]*\\n([\\s\\S]*?)(?=^[ \\t]*\\[|$(?![\\s\\S]))`, "m");
  const match = table.exec(toml);
  if (match && /^[ \t]*title[ \t]*=/m.test(match[1])) {
    const body = match[1].replace(/^([ \t]*)title[ \t]*=[^\r\n]*/m, `$1title = ${JSON.stringify(title)}`);
    return toml.slice(0, match.index) + match[0].replace(match[1], body) + toml.slice(match.index + match[0].length);
  }
  return setTomlKey(toml, "title", title);
}

/**
 * Top-level folders of a theme repository that belong to the theme or the repository, not to a
 * site; everything else (static/, data/, syntaxes/, i18n/…) is the demo site's, and the theme's
 * templates may read it from the site's root (load_data, extra_grammars), so a new site gets it.
 */
const NOT_SITE = /^(templates|sass|content|themes|public|node_modules|docs|scripts|tests?|screenshots?|\.[^/]+)\//;

/** The content file a failed build names, e.g. "content/posts/a.md" (to leave a broken demo page out) */
export function failingContent(stderr: string[]): string | null {
  for (const line of stderr) {
    const match = /Failed to render (?:page|section|page content of|section content of)[^'"]*['"][^'"]*?\/(content\/[^'"]+\.md)['"]/.exec(line);
    if (match) return match[1];
  }
  return null;
}

function workflow(zolaVersion: string): string {
  return `# Builds the site with Zola and publishes it to GitHub Pages (Settings > Pages > Source: GitHub Actions)
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

env:
  ZOLA_VERSION: ${zolaVersion}

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
      - name: Install Zola
        run: curl -sL "https://github.com/getzola/zola/releases/download/v\${ZOLA_VERSION}/zola-v\${ZOLA_VERSION}-x86_64-unknown-linux-gnu.tar.gz" | tar xz -C /usr/local/bin
      - id: pages
        uses: actions/configure-pages@v5
      - run: zola build --base-url "\${{ steps.pages.outputs.base_url }}"
      - uses: actions/upload-pages-artifact@v3
        with:
          path: public
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}

/** A theme template that renders a page's content: page.html if it does, else the first that does */
export function contentTemplate(theme: Map<string, Uint8Array>): string | null {
  const shows = (path: string) => /\{\{-?\s*page\.content\b/.test(decoder.decode(theme.get(path)));
  if (theme.has("templates/page.html") && shows("templates/page.html")) return "page.html";
  const candidates = [...theme.keys()]
    .filter((path) => /^templates\/[^/]+\.html$/.test(path) && !/^templates\/(index|section|base|_base|404|taxonomy[^/]*)\.html$/.test(path))
    .sort();
  const found = candidates.find(shows);
  return found ? found.slice("templates/".length) : null;
}

/** The files of a new site using the theme in `theme` (a theme repository's files) */
export function siteFromTheme(theme: Map<string, Uint8Array>, options: NewSiteOptions): Map<string, Uint8Array> {
  const site = new Map<string, Uint8Array>();
  for (const [path, data] of theme) {
    if (!NOT_THEME.test(path)) site.set(`themes/${options.themeName}/${path}`, data);
  }

  // The theme's demo config: it sets what the theme's templates expect under [extra]
  const demo = ["zola.toml", "config.toml"].find((path) => theme.has(path));
  let config = demo ? decoder.decode(theme.get(demo)) : "";
  config = setTomlKey(config, "base_url", options.baseUrl || "https://example.com");
  config = setTitle(config, options.title);
  config = setTomlKey(config, "theme", options.themeName);
  site.set("zola.toml", encoder.encode(config));

  // The demo site's own files at the repository root
  for (const [path, data] of theme) {
    if (path.includes("/") && !NOT_SITE.test(path) && !site.has(path)) site.set(path, data);
  }

  // Its demo content, to start from; or a first page when it has none
  if (options.content !== "starter") for (const [path, data] of theme) if (path.startsWith("content/")) site.set(path, data);
  if (![...site.keys()].some((path) => path.startsWith("content/"))) {
    // The starter page is drawn with a theme template that shows a page's content: page.html, or
    // whichever does when the theme has its own name for it (e.g. post.html)
    const pageTemplate = contentTemplate(theme);
    const section = pageTemplate && pageTemplate !== "page.html" ? `page_template = ${JSON.stringify(pageTemplate)}\nsort_by = "date"\n` : "";
    site.set("content/_index.md", encoder.encode(`+++\ntitle = ${JSON.stringify(options.title)}\n${section}+++\n`));
    site.set("content/hello.md", encoder.encode(`+++\ntitle = "Hello"\ndate = ${new Date().toISOString().slice(0, 10)}\n+++\n\nThe first page of ${options.title}.\n`));
  }

  site.set(".github/workflows/deploy.yml", encoder.encode(workflow(options.zolaVersion)));
  site.set(".gitignore", encoder.encode("public/\n"));
  return site;
}

export interface PreparedSite {
  files: Map<string, Uint8Array>;
  /** Demo pages left out because they don't build here (e.g. they load data from the web) */
  dropped: string[];
  /** The demo content didn't build at all: the site starts from a starter page */
  starter: boolean;
  /** Why, when even the starter site doesn't build */
  error?: string;
}

type Build = (files: Map<string, Uint8Array>) => Promise<{ ok: boolean; stderr: string[] }>;

/**
 * A new site that builds: with the theme's demo content, minus pages that fail (one at a time,
 * as Zola names them), or else with a starter page.
 */
export async function prepareSite(theme: Map<string, Uint8Array>, options: NewSiteOptions, build: Build): Promise<PreparedSite> {
  let files = siteFromTheme(theme, options);
  const dropped: string[] = [];
  for (let attempt = 0; attempt < 25; attempt++) {
    const result = await build(files);
    if (result.ok) return { files, dropped, starter: false };
    const failing = failingContent(result.stderr);
    if (!failing || !files.has(failing)) break;
    files.delete(failing);
    dropped.push(failing);
  }
  files = siteFromTheme(theme, { ...options, content: "starter" });
  const result = await build(files);
  return { files, dropped: [], starter: true, ...(result.ok ? {} : { error: result.stderr.filter((l) => /ERROR|-->|\|/.test(l)).slice(-8).join("\n") }) };
}
