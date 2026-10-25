// HTML in pages, in the editor: paired tags around Markdown are a container node (html_block) or a
// mark on text (html_inline), drawn as the real elements so they look as published; any other HTML
// is shown rendered. See src/markdown/remark-html.ts for how they're read and written.
import { htmlSchema } from "@milkdown/kit/preset/commonmark";
import type { Mark, Node as ProseNode } from "@milkdown/kit/prose/model";
import { $mark, $node, $remark, $view } from "@milkdown/kit/utils";
import { safeAttributes, UNSAFE_TAGS } from "../markdown/html.ts";
import { remarkHtml } from "../markdown/remark-html.ts";

export const remarkHtmlPlugin = $remark("remarkHtml", () => remarkHtml as never);

const safeTag = (tag: string, fallback: string) => (UNSAFE_TAGS.has(tag) || !/^[a-z][\w-]*$/.test(tag) ? fallback : tag);

/** The summary's text, for <summary>…</summary> written as HTML */
export function summaryText(summary: string | null): string {
  if (!summary) return "";
  const doc = new DOMParser().parseFromString(summary, "text/html");
  return doc.body.textContent?.trim() ?? "";
}

export const htmlBlock = $node("html_block", () => ({
  group: "block",
  content: "block+",
  defining: true,
  attrs: { tag: { default: "div" }, attrs: { default: "" }, close: { default: "" }, summary: { default: null } },
  parseDOM: [],
  toDOM: (node) => {
    const tag = safeTag(node.attrs.tag, "div");
    const attrs: Record<string, string> = Object.fromEntries(safeAttributes(node.attrs.attrs));
    attrs["data-zd-html"] = tag;
    if (tag === "details") {
      // Open while editing, and the title isn't typed into: it's edited from the block's menu
      return ["details", { ...attrs, open: "" }, ["summary", { contenteditable: "false", class: "zd-summary" }, summaryText(node.attrs.summary) || "Details"], ["div", { class: "zd-details-body" }, 0]];
    }
    return [tag, attrs, 0];
  },
  parseMarkdown: {
    match: (node) => node.type === "htmlContainer",
    runner: (state, node, type) => {
      const { tag, attrs, close, summary } = node as unknown as { tag: string; attrs: string; close: string; summary?: string };
      state.openNode(type, { tag, attrs, close, summary: summary ?? null });
      state.next(node.children as never);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "html_block",
    runner: (state, node) => {
      const { tag, attrs, close, summary } = node.attrs;
      state.openNode("htmlContainer", undefined, { tag, attrs, close, ...(summary ? { summary } : {}) });
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export const htmlInline = $mark("html_inline", () => ({
  attrs: { tag: { default: "span" }, attrs: { default: "" }, close: { default: "" } },
  // Colour and highlight can apply to the same words
  excludes: "",
  parseDOM: [],
  toDOM: (mark: Mark) => [safeTag(mark.attrs.tag, "span"), Object.fromEntries(safeAttributes(mark.attrs.attrs)), 0],
  parseMarkdown: {
    match: (node) => node.type === "htmlInline",
    runner: (state, node, markType) => {
      const { tag, attrs, close } = node as unknown as { tag: string; attrs: string; close: string };
      state.openMark(markType, { tag, attrs, close });
      state.next(node.children as never);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === "html_inline",
    runner: (state, mark) => {
      const { tag, attrs, close } = mark.attrs;
      state.withMark(mark, "htmlInline", undefined, { tag, attrs, close });
    },
  },
}));

/** Rendered HTML without anything that could run or load: scripts, frames, event handlers */
function sanitized(html: string, doc: Document): DocumentFragment {
  const template = doc.createElement("template");
  template.innerHTML = html;
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (UNSAFE_TAGS.has(element.localName)) element.remove();
    else for (const { name, value } of [...element.attributes]) if (/^on/i.test(name) || /^\s*javascript:/i.test(value)) element.removeAttribute(name);
  }
  return template.content;
}

/** Other HTML (a tag without its pair, HTML with text in it): shown rendered, edited in Source */
export const rawHtmlView = $view(htmlSchema.node, () => (node: ProseNode, view) => {
  const doc = view.dom.ownerDocument;
  const value: string = node.attrs.value ?? "";
  const lone = /^\s*<\/?[A-Za-z][^>]*>\s*$/.test(value);
  const dom = doc.createElement(lone ? "code" : "span");
  dom.className = lone ? "zd-component zd-tera" : "zd-raw-html";
  dom.contentEditable = "false";
  dom.title = `HTML: ${value.trim().slice(0, 200)}\nEdit it in the Source view.`;
  if (lone) dom.textContent = value.trim();
  else dom.append(sanitized(value, doc));
  return { dom, ignoreMutation: () => true };
});
