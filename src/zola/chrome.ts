// The "chrome" build: the site exactly as published, except every page's body is a marker (and the
// page's headings, so the theme's table of contents is right, and as many words as Zola counts in
// the real body, so its word count and reading time are). The theme renders its header, title,
// metadata, navigation and footer around it, and the editor takes its place. Without bodies, no
// component work (images…) happens: it's fast.
//
// Each marker names its content file, so the output also tells us where Zola put every page
// (slugs, `path` overrides and dates included) without re-implementing its rules.
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import { endMarker, markerPath, START_MARKER, startMarker } from "./markers.ts";

const segmenter = new Intl.Segmenter("en", { granularity: "word" });

/**
 * What Zola counts in a page's Markdown for word_count and reading_time (get_reading_analytics):
 * words (Unicode word segments with a letter or digit) outside ``` pairs; for Chinese and Japanese,
 * letters.
 */
export function wordCount(markdown: string, lang: string): number {
  const cjk = /^(zh|ja)\b/.test(lang);
  let count = 0;
  markdown.split("```").forEach((part, i) => {
    if (i % 2) return;
    if (cjk) count += [...part].filter((char) => /\p{Alphabetic}/u.test(char)).length;
    else for (const { segment } of segmenter.segment(part)) if (/[\p{Alphabetic}\p{Number}]/u.test(segment)) count++;
  });
  return count;
}

/** An HTML comment Zola counts as `words` words (letters for Chinese and Japanese), which shows nothing */
function filler(words: number, lang: string): string {
  if (words <= 0) return "";
  return /^(zh|ja)\b/.test(lang) ? `<!--${"字".repeat(words)}-->` : `<!--${" x".repeat(words)} -->`;
}

/** The ATX headings of a page's Markdown (outside code), without Tera, for page.toc */
export function headingLines(body: string): string[] {
  const out: string[] = [];
  let fence: string | null = null;
  // Inside a component's body ({% <row> %}…{% </row> %}, {% note() %}…{% end %}): Zola renders
  // it on its own, and its headings aren't in the page's table of contents
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0].repeat(marker.length);
      else if (marker.startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    if (!depth && /^ {0,3}#{1,6}[ \t]+\S/.test(line)) out.push(line.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, "").trimEnd());
    for (const [tag] of line.matchAll(/\{%-?[\s\S]*?-?%\}/g)) {
      if (/^\{%-?\s*<\/[\w.]+\s*>\s*-?%\}$/.test(tag) || /^\{%-?\s*end\s*-?%\}$/.test(tag)) depth = Math.max(0, depth - 1);
      else if (/^\{%-?\s*<[\w.]+[\s\S]*?[^/]>\s*-?%\}$/.test(tag) || /^\{%-?\s*<[\w.]+>\s*-?%\}$/.test(tag) || /^\{%-?\s*[\w.]+\s*\([\s\S]*\)\s*-?%\}$/.test(tag)) depth++;
    }
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Overrides replacing every page body under content/ with its marker, keeping front matter.
 * `lang` gives a page's language, which decides how Zola counts its words.
 */
export function chromeOverrides(contentPages: string[], text: (path: string) => string, lang: (path: string) => string = () => "en"): Map<string, Uint8Array> {
  const overrides = new Map<string, Uint8Array>();
  for (const path of contentPages) {
    const { frontMatter, body } = splitFrontMatter(text(path));
    // Nothing in it: Zola renders it as it is (a theme may leave out the content's wrapper), and it's
    // written in the Source view until it has content
    if (!body.trim()) {
      overrides.set(path, encoder.encode(frontMatter));
      continue;
    }
    const separator = frontMatter && !frontMatter.endsWith("\n") ? "\n" : "";
    const language = lang(path);
    const parts = [startMarker(path), ...headingLines(body), endMarker(path)];
    // As many words as Zola counts in the real body, markers included
    const pad = filler(wordCount(body, language) - wordCount(parts.join("\n\n"), language), language);
    if (pad) parts.splice(-1, 0, pad);
    overrides.set(path, encoder.encode(`${frontMatter}${separator}\n${parts.join("\n\n")}\n`));
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
    const found = [...decoder.decode(data).matchAll(START_MARKER)].map(markerPath);
    for (const content of found) {
      const current = best.get(content);
      if (!current || found.length < current.markers) best.set(content, { path, markers: found.length });
    }
  }
  return new Map([...best].map(([content, { path }]) => [content, path]));
}
