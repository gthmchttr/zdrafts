// The page's Markdown drawn as Zola renders it (src/markdown/zola-render.ts): links and images with
// Zola's URLs and attributes, headings with Zola's ids and classes. What only helps editing (a
// heading's {#id} block) is marked zd-editing.
import { headingSchema, imageSchema, linkSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { headingAttributes, imageAttributes, linkAttributes, slugifyAnchor, uniqueAnchor, type RenderInfo } from "../markdown/zola-render.ts";
import { ANCHOR_ID } from "./anchors.ts";

export function zolaLinks(info: RenderInfo) {
  return linkSchema.extendSchema((schema) => (ctx) => ({
    ...schema(ctx),
    toDOM: (mark) => ["a", linkAttributes(String(mark.attrs.href ?? ""), mark.attrs.title || null, info)],
  }));
}

/** Images as Zola writes them; `image` is the editor's own image schema */
export function zolaImages(image: typeof imageSchema, info: RenderInfo) {
  return image.extendSchema((schema) => (ctx) => ({
    ...schema(ctx),
    toDOM: (node) => ["img", imageAttributes(String(node.attrs.src ?? ""), String(node.attrs.alt ?? ""), node.attrs.title || null, info)],
  }));
}

/** Headings with Zola's id, classes from their {.class} block, and the theme's anchor link */
export function zolaHeadings(info: RenderInfo) {
  return headingSchema.extendSchema((schema) => (ctx) => ({
    ...schema(ctx),
    // anchor: whether Zola gives it the anchor link (the page's own headings, not components'; set by headingIds)
    attrs: { ...schema(ctx).attrs, anchor: { default: true } },
    toDOM: (node) => {
      const classes = headingAttributes(node.textContent)?.classes ?? [];
      const attrs = { id: node.attrs.id, ...(classes.length ? { class: classes.join(" ") } : {}) };
      const anchor = info.anchor;
      if (!anchor || !node.attrs.id || !node.attrs.anchor) return [`h${node.attrs.level}`, attrs, 0];
      const heading = document.createElement(`h${node.attrs.level}`);
      for (const [name, value] of Object.entries(attrs)) heading.setAttribute(name, value);
      const template = document.createElement("template");
      template.innerHTML = anchor.html;
      const link = template.content.firstElementChild!;
      for (const attribute of [...link.attributes]) link.setAttribute(attribute.name, attribute.value.replaceAll(ANCHOR_ID, node.attrs.id));
      if (anchor.mode === "heading") {
        heading.append(link);
        return { dom: heading, contentDOM: link };
      }
      link.setAttribute("contenteditable", "false");
      const content = document.createElement("span");
      content.className = "zd-unwrap";
      heading.append(...(anchor.mode === "left" ? [link, content] : [content, link]));
      return { dom: heading, contentDOM: content };
    },
  }));
}

/** Text Zola leaves out of a heading: its attributes block, and the spaces before it */
function headingText(node: ProseNode) {
  const attrs = headingAttributes(node.textContent);
  return { text: (attrs ? node.textContent.slice(0, attrs.start) : node.textContent).trim(), attrs };
}

const key = new PluginKey("zdrafts-heading-ids");

/**
 * Headings' ids as Zola gives them: an explicit {#id}; else for the page's own headings the ids
 * Zola gave them, while their text is the same; else a slug of the text, numbered if repeated.
 * Components' bodies are rendered on their own, so their headings are numbered on their own.
 */
export function headingIds(info: RenderInfo) {
  const ids = (doc: ProseNode) => {
    const found: { pos: number; id: string; anchor: boolean }[] = [];
    const used = new Map<ProseNode, Set<string>>();
    let top = 0;
    doc.descendants((node, pos) => {
      if (node.type.name !== "heading") return true;
      const $pos = doc.resolve(pos);
      let scope: ProseNode = doc;
      for (let depth = $pos.depth; depth > 0; depth--) {
        if ($pos.node(depth).type.name === "zola_block") {
          scope = $pos.node(depth);
          break;
        }
      }
      if (!used.has(scope)) used.set(scope, new Set());
      const taken = used.get(scope)!;
      const { text, attrs } = headingText(node);
      const zola = scope === doc ? info.headings[top++] : undefined;
      let id: string;
      if (attrs?.id) id = attrs.id;
      else {
        id = zola && zola.text === text ? zola.id : uniqueAnchor(taken, slugifyAnchor(text, info.markdown.slugifyAnchors));
        taken.add(id);
      }
      // Components' bodies are rendered without anchors
      found.push({ pos, id, anchor: scope === doc });
      return false;
    });
    return found;
  };
  const sync = (view: EditorView) => {
    if (view.composing) return;
    const tr = view.state.tr.setMeta("addToHistory", false);
    let changed = false;
    for (const { pos, id, anchor } of ids(view.state.doc)) {
      const node = view.state.doc.nodeAt(pos)!;
      if (node.attrs.id !== id || node.attrs.anchor !== anchor) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, id, anchor });
        changed = true;
      }
    }
    if (changed) view.dispatch(tr);
  };
  return $prose(
    () =>
      new Plugin({
        key,
        view: (view) => {
          sync(view);
          return { update: (next, previous) => !next.state.doc.eq(previous.doc) && sync(next) };
        },
        // A heading's {#id .class} block only helps editing: Zola doesn't show it
        props: {
          decorations: (state) => {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "heading") return true;
              const attrs = headingAttributes(node.textContent);
              // (Offsets in the text are positions only when the heading is all text)
              if (attrs && node.textContent.length === node.content.size) decorations.push(Decoration.inline(pos + 1 + attrs.start, pos + node.nodeSize - 1, { class: "zd-editing zd-heading-attrs" }));
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
  );
}
