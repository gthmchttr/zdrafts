// The "chrome" build: the site exactly as published, except every page's body is a marker.
// The theme renders its header, title, metadata, navigation and footer around the marker, and the
// editor takes the marker's place. Without bodies, no component work (images…) happens: it's fast.
//
// Each marker names its content file, so the output also tells us where Zola put every page
// (slugs, `path` overrides and dates included) without re-implementing its rules.
import { splitFrontMatter } from "../markdown/frontmatter.ts";

const MARKER = /<!--zdrafts:content:(.+?)-->/g;

export function contentMarker(contentPath: string): string {
  return `<!--zdrafts:content:${contentPath}-->`;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Overrides replacing every page body under content/ with its marker, keeping front matter */
export function chromeOverrides(contentPages: string[], text: (path: string) => string): Map<string, Uint8Array> {
  const overrides = new Map<string, Uint8Array>();
  for (const path of contentPages) {
    const { frontMatter } = splitFrontMatter(text(path));
    const separator = frontMatter && !frontMatter.endsWith("\n") ? "\n" : "";
    overrides.set(path, encoder.encode(`${frontMatter}${separator}\n${contentMarker(path)}\n`));
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
