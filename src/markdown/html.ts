// Small helpers for the HTML tags zdrafts reads and writes in Markdown: splitting raw HTML into
// tags, and reading or changing a tag's attributes and inline style without disturbing the rest.

/** Elements that never have a closing tag */
export const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export interface Tag {
  /** The tag as written, e.g. `<div style="x">` or `</div>` */
  raw: string;
  name: string;
  closing: boolean;
  /** `<x/>` or a void element: nothing to pair with */
  single: boolean;
  /** Everything between the name and `>` (with its leading space), e.g. ` style="x"` */
  attrs: string;
}

const TAG = /^<(\/?)([A-Za-z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>$/;

export function parseTag(raw: string): Tag | null {
  const match = TAG.exec(raw);
  if (!match) return null;
  const name = match[2].toLowerCase();
  return { raw, name, closing: match[1] === "/", single: match[4] === "/" || VOID_TAGS.has(name), attrs: match[3] };
}

/** The tags of a piece of raw HTML that is nothing but tags (and whitespace), or null */
export function onlyTags(html: string): Tag[] | null {
  const tags: Tag[] = [];
  const rest = html.replace(/<[^<>]+>/g, (raw) => {
    const tag = parseTag(raw);
    if (tag) tags.push(tag);
    return tag ? "" : raw;
  });
  return rest.trim() === "" && tags.length ? tags : null;
}

// --- attributes -----------------------------------------------------------------------------

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function parseAttributes(attrs: string): [string, string | null][] {
  return [...attrs.matchAll(ATTR)].map((m) => [m[1], m[2] ?? m[3] ?? m[4] ?? null]);
}

export function formatAttributes(list: [string, string | null][]): string {
  return list.map(([name, value]) => (value === null ? ` ${name}` : ` ${name}="${value.replace(/"/g, "&quot;")}"`)).join("");
}

export function parseStyle(style: string): [string, string][] {
  return style
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): [string, string] => {
      const colon = part.indexOf(":");
      return colon < 0 ? [part, ""] : [part.slice(0, colon).trim().toLowerCase(), part.slice(colon + 1).trim()];
    });
}

export function getStyle(attrs: string, property: string): string | null {
  const style = parseAttributes(attrs).find(([name]) => name.toLowerCase() === "style")?.[1];
  return style ? (parseStyle(style).find(([name]) => name === property)?.[1] ?? null) : null;
}

/** `attrs` with these style properties set (null removes one); the style attribute goes when empty */
export function setStyles(attrs: string, changes: Record<string, string | null>): string {
  const list = parseAttributes(attrs);
  const index = list.findIndex(([name]) => name.toLowerCase() === "style");
  let style = index >= 0 ? parseStyle(list[index][1] ?? "") : [];
  for (const [property, value] of Object.entries(changes)) {
    const at = style.findIndex(([name]) => name === property);
    if (value === null) style = style.filter(([name]) => name !== property);
    else if (at >= 0) style[at] = [property, value];
    else style.push([property, value]);
  }
  const text = style.map(([name, value]) => `${name}: ${value}`).join("; ");
  if (index >= 0) {
    if (text) list[index] = [list[index][0], text];
    else list.splice(index, 1);
  } else if (text) list.push(["style", text]);
  return formatAttributes(list);
}

/** Attributes safe to put on an element in the editor: no event handlers or script URLs */
export function safeAttributes(attrs: string): [string, string][] {
  return parseAttributes(attrs)
    .filter(([name, value]) => !/^on/i.test(name) && !/^\s*javascript:/i.test(value ?? ""))
    .map(([name, value]) => [name, value ?? ""]);
}

/** Elements the editor won't create from page content */
export const UNSAFE_TAGS = new Set(["script", "style", "iframe", "object", "embed", "frame", "frameset", "template", "noscript", "base", "meta", "link"]);
