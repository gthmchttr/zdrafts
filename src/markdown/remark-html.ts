// HTML tags in Markdown, as nodes: Zola passes HTML through and Markdown between tags is still
// Markdown, so a pair of tags around Markdown is an element with editable content.
//
//   htmlContainer  <div style="…">           (blank line)  blocks  (blank line)  </div>
//   htmlInline     <span style="…">text</span>, <u>…</u>, <kbd>…</kbd> … inside a paragraph
//
// Anything else (unpaired tags, HTML with text in it) stays a plain `html` node. Tags are kept as
// written, so an untouched page is written back exactly.
import type { Nodes, Parent, Root } from "mdast";
import type { Handle, Join, Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import { onlyTags, type Tag } from "./html.ts";

export interface HtmlContainer extends Parent {
  type: "htmlContainer";
  tag: string;
  /** The attributes as written, with their leading space */
  attrs: string;
  /** The closing tag as written */
  close: string;
  /** For <details>: the <summary> line that follows the opening tag */
  summary?: string;
}

export interface HtmlInline extends Parent {
  type: "htmlInline";
  tag: string;
  attrs: string;
  close: string;
}

const DETAILS = /^<details((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*>\s*(<summary\b[^>]*>[\s\S]*?<\/summary>)\s*$/i;

/** unified plugin: run after remark-parse, gfm and remarkZola */
export function remarkHtml() {
  return (tree: Root) => transform(tree as unknown as Parent);
}

/** Parents whose children are text: tags in them are inline */
const PHRASING_PARENTS = new Set(["paragraph", "heading", "emphasis", "strong", "delete", "link", "linkReference", "tableCell", "htmlInline"]);

/** An opening tag waiting for its closing tag */
interface Opener {
  opener: true;
  open: Tag;
  summary?: string;
}

type Item = Nodes | Opener;

const isOpener = (item: Item): item is Opener => (item as Opener).opener === true;

function transform(parent: Parent) {
  const children = parent.children as Nodes[];
  for (const child of children) if ("children" in child && Array.isArray(child.children)) transform(child as Parent);
  const block = !PHRASING_PARENTS.has(parent.type);
  const items: Item[] = [];
  const stack: number[] = [];

  const close = (tag: Tag) => {
    for (let s = stack.length - 1; s >= 0; s--) {
      const opener = items[stack[s]] as Opener;
      if (opener.open.name !== tag.name) continue;
      const start = stack[s];
      stack.length = s;
      const inner = items.splice(start + 1).map(plain);
      const node = block
        ? ({ type: "htmlContainer", tag: tag.name, attrs: opener.open.attrs, close: tag.raw, children: inner, ...(opener.summary ? { summary: opener.summary } : {}) } as HtmlContainer)
        : ({ type: "htmlInline", tag: tag.name, attrs: opener.open.attrs, close: tag.raw, children: inner } as HtmlInline);
      items[start] = node as unknown as Nodes;
      return true;
    }
    return false;
  };

  for (const child of children) {
    if (child.type !== "html") {
      items.push(child);
      continue;
    }
    // <details><summary>…</summary> opens a collapsible block
    const details = block ? DETAILS.exec(child.value.trim()) : null;
    if (details) {
      stack.push(items.length);
      items.push({ opener: true, open: { raw: `<details${details[1]}>`, name: "details", closing: false, single: false, attrs: details[1] }, summary: details[2] });
      continue;
    }
    const tags = onlyTags(child.value);
    // Inline, a tag is one html node; in blocks, one html node may hold several tags on lines of their own
    if (!tags || (!block && tags.length !== 1)) {
      items.push(child);
      continue;
    }
    for (const tag of tags) {
      if (tag.single) items.push({ type: "html", value: tag.raw });
      else if (!tag.closing) {
        stack.push(items.length);
        items.push({ opener: true, open: tag });
      } else if (!close(tag)) items.push({ type: "html", value: tag.raw });
    }
  }
  parent.children = items.map(plain) as Parent["children"];
}

/** Opening tags that never found their closing tag stay raw HTML */
function plain(item: Item): Nodes {
  if (!isOpener(item)) return item;
  return { type: "html", value: item.summary ? `${item.open.raw}\n${item.summary}` : item.open.raw };
}

// --- stringify ------------------------------------------------------------------------------

const htmlContainer: Handle = (node, _parent, state, info) => {
  const element = node as unknown as HtmlContainer;
  const open = `<${element.tag}${element.attrs}>${element.summary ? `\n${element.summary}` : ""}`;
  const close = element.close || `</${element.tag}>`;
  const exit = state.enter("htmlContainer" as never);
  const inner = state.containerFlow(element as never, info);
  exit();
  // A container right inside another sits on the next line (<div>\n<div>), as people write it;
  // Markdown inside needs a blank line before and after to be read as Markdown
  const isContainer = (child: unknown) => (child as { type?: string } | undefined)?.type === "htmlContainer";
  const before = isContainer(element.children[0]) ? "\n" : "\n\n";
  const after = isContainer(element.children.at(-1)) ? "\n" : "\n\n";
  return inner ? `${open}${before}${inner}${after}${close}` : `${open}\n\n${close}`;
};

const htmlInline: Handle = (node, _parent, state, info) => {
  const element = node as unknown as HtmlInline;
  const exit = state.enter("htmlInline" as never);
  const inner = state.containerPhrasing(element as never, { ...info, before: ">", after: "<" });
  exit();
  return `<${element.tag}${element.attrs}>${inner}${element.close || `</${element.tag}>`}`;
};

/** Handlers for remark-stringify / mdast-util-to-markdown */
export const htmlHandlers: NonNullable<ToMarkdownOptions["handlers"]> = { htmlContainer, htmlInline } as never;

/** Sibling containers inside a container go on consecutive lines: </div>\n<div> */
export const htmlJoin: Join = (left, right, parent) =>
  (left.type as string) === "htmlContainer" && (right.type as string) === "htmlContainer" && (parent.type as string) === "htmlContainer" ? 0 : undefined;
