// The "chrome" build: the site exactly as published, except every page's body is a marker (and the
// page's headings, so the theme's table of contents is right). The theme renders its header, title,
// metadata, navigation and footer around it, and the editor takes its place. Without bodies, no
// component work (images…) happens: it's fast.
//
// Each marker names its content file, so the output also tells us where Zola put every page
// (slugs, `path` overrides and dates included) without re-implementing its rules.
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import { setTomlKey } from "../site/newsite.ts";

const MARKER = /<!--zdrafts:content:(.+?)-->/g;

export function contentMarker(contentPath: string): string {
  return `<!--zdrafts:content:${contentPath}-->`;
}

/** Where the stand-in content ends: the editor replaces everything from the marker to here */
export function contentEndMarker(contentPath: string): string {
  return `<!--zdrafts:end:${contentPath}-->`;
}

/** The ATX headings of a page's Markdown (outside code), without Tera, for page.toc */
export function headingLines(body: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0].repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (!fence && /^ {0,3}#{1,6}[ \t]+\S/.test(line)) out.push(line.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "").trimEnd());
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Overrides replacing every page body under content/ with its marker, keeping front matter */
export function chromeOverrides(contentPages: string[], text: (path: string) => string): Map<string, Uint8Array> {
  const overrides = new Map<string, Uint8Array>();
  for (const path of contentPages) {
    const { frontMatter, body } = splitFrontMatter(text(path));
    const separator = frontMatter && !frontMatter.endsWith("\n") ? "\n" : "";
    const headings = headingLines(body);
    const inner = headings.length ? `\n\n${headings.join("\n\n")}\n\n` : "\n";
    overrides.set(path, encoder.encode(`${frontMatter}${separator}\n${contentMarker(path)}${inner}${contentEndMarker(path)}\n`));
  }
  return overrides;
}

/** Content path → output HTML path, for every page whose template shows its content */
export function findPages(output: Map<string, Uint8Array>): Map<string, string> {
  // A listing page might print several pages' content; a page's own output has only its marker,
  // so each content file goes to the output with the fewest markers that contains it
  const best = new Map<string, { path: string; markers: number }>();
  for (const [path, data] of output) {
    if (!path.endsWith(".html")) continue;
    const found = [...decoder.decode(data).matchAll(MARKER)].map((match) => match[1]);
    for (const content of found) {
      const current = best.get(content);
      if (!current || found.length < current.markers) best.set(content, { path, markers: found.length });
    }
  }
  return new Map([...best].map(([content, { path }]) => [content, path]));
}

/**
 * The site's config for preview builds, if it needs changes: minifying HTML would strip the content
 * markers (HTML comments), so it's turned off. Returns null when the config can be used as it is.
 */
export function previewConfig(config: string): string | null {
  const header = config.search(/^[ \t]*\[/m);
  const top = header < 0 ? config : config.slice(0, header);
  return /^[ \t]*minify_html[ \t]*=[ \t]*true\b/m.test(top) ? setTomlKey(config, "minify_html", false) : null;
}
