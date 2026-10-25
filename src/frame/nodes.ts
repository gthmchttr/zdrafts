// ProseMirror nodes for Zola's Tera syntax, and node views that draw them with the theme's real
// markup (from probes), so components look as published and their content is editable in place.
import { imageSchema } from "@milkdown/kit/preset/commonmark";
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@milkdown/kit/prose/view";
import { $node, $prose, $remark, $view } from "@milkdown/kit/utils";
import { remarkZola } from "../markdown/remark-zola.ts";
import { getAttr, setStringAttr } from "../markdown/tera.ts";
import type { ComponentInfo } from "../zola/components.ts";
import { SLOT_COMMENT, type ProbeCall, type ProbeResult } from "../zola/probe.ts";
import type { Probes } from "./probes.ts";

export interface EditorEnv {
  doc: Document;
  probes: Probes;
  components: Map<string, ComponentInfo>;
  /** Where the site is served, e.g. http://localhost:5173/site */
  siteUrl: string;
  /** Called for a component's settings (from the handle or a click on an atom) */
  openSettings: (element: HTMLElement) => void;
}

/** Elements drawn for component nodes, so the UI can find the node behind them */
export const componentElements = new WeakMap<Element, { getPos: () => number | undefined; view: EditorView }>();
export const COMPONENT_ATTR = "data-zd-component";

export const remarkZolaPlugin = $remark("remarkZola", () => remarkZola as never);

// --- schemas --------------------------------------------------------------------------------

export function zolaNodes(env: EditorEnv) {
  const isTextComponent = (node: { name?: string; args?: string }) => {
    const info = node.name ? env.components.get(node.name) : undefined;
    return !!info?.textParam && getAttr(node.args ?? "", "text")?.kind === "string";
  };

  const block = $node("zola_block", () => ({
    group: "block",
    content: "block+",
    defining: true,
    isolating: true,
    attrs: { name: { default: "" }, args: { default: "" }, open: { default: null }, close: { default: null } },
    parseDOM: [],
    toDOM: (node) => ["div", { [COMPONENT_ATTR]: node.attrs.name }, 0],
    parseMarkdown: {
      match: (node) => node.type === "zolaBlock",
      runner: (state, node, type) => {
        const { name, args, open, close } = node as unknown as { name: string; args: string; open?: string; close?: string };
        state.openNode(type, { name, args, open: open ?? null, close: close ?? null });
        state.next(node.children as never);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "zola_block",
      runner: (state, node) => {
        const { name, args, open, close } = node.attrs;
        state.openNode("zolaBlock", undefined, { name, args, ...(open ? { open } : {}), ...(close ? { close } : {}) });
        state.next(node.content);
        state.closeNode();
      },
    },
  }));

  const text = $node("zola_text", () => ({
    group: "inline",
    inline: true,
    content: "text*",
    marks: "",
    attrs: { name: { default: "" }, args: { default: "" }, raw: { default: "" }, originalText: { default: "" } },
    parseDOM: [],
    toDOM: (node) => ["span", { [COMPONENT_ATTR]: node.attrs.name }, 0],
    parseMarkdown: {
      match: (node) => node.type === "zolaInline" && isTextComponent(node as never),
      runner: (state, node, type) => {
        const { name, args, raw } = node as unknown as { name: string; args: string; raw?: string };
        const value = (getAttr(args, "text") as { value: string }).value;
        state.openNode(type, { name, args, raw: raw ?? "", originalText: value });
        if (value) state.addText(value);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "zola_text",
      runner: (state, node) => {
        const { name, args, raw, originalText } = node.attrs;
        const value = node.textContent;
        const unchanged = value === originalText;
        state.addNode("zolaInline", undefined, undefined, {
          name,
          args: unchanged ? args : setStringAttr(args, "text", value),
          ...(unchanged && raw ? { raw } : {}),
        });
      },
    },
  }));

  const atom = $node("zola_atom", () => ({
    group: "inline",
    inline: true,
    atom: true,
    selectable: true,
    draggable: true,
    attrs: { name: { default: "" }, args: { default: "" }, raw: { default: "" } },
    parseDOM: [],
    toDOM: (node) => ["span", { [COMPONENT_ATTR]: node.attrs.name || "tera" }],
    parseMarkdown: {
      match: (node) => (node.type === "zolaInline" && !isTextComponent(node as never)) || node.type === "zolaTera",
      runner: (state, node, type) => {
        const { name, args, raw } = node as unknown as { name?: string; args?: string; raw?: string };
        state.addNode(type, { name: name ?? "", args: args ?? "", raw: raw ?? "" });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "zola_atom",
      runner: (state, node) => {
        const { name, args, raw } = node.attrs;
        if (name) state.addNode("zolaInline", undefined, undefined, { name, args, ...(raw ? { raw } : {}) });
        else state.addNode("zolaTera", undefined, undefined, { raw });
      },
    },
  }));

  const teraBlock = $node("zola_tera_block", () => ({
    group: "block",
    atom: true,
    selectable: true,
    attrs: { raw: { default: "" } },
    parseDOM: [],
    toDOM: () => ["div", { [COMPONENT_ATTR]: "tera" }],
    parseMarkdown: {
      match: (node) => node.type === "zolaTeraBlock",
      runner: (state, node, type) => {
        state.addNode(type, { raw: (node as unknown as { raw: string }).raw });
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === "zola_tera_block",
      runner: (state, node) => {
        state.addNode("zolaTeraBlock", undefined, undefined, { raw: node.attrs.raw });
      },
    },
  }));

  return { block, text, atom, teraBlock };
}

// --- views ----------------------------------------------------------------------------------

function fragment(doc: Document, html: string): DocumentFragment {
  const template = doc.createElement("template");
  template.innerHTML = html;
  // Whitespace between block-level tags is insignificant in HTML, but not inside the editor
  const walker = doc.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const blank: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent!.trim() && node.textContent!.includes("\n")) blank.push(node as Text);
  }
  blank.forEach((node) => node.remove());
  return template.content;
}

/** The fragment's only element, if it has exactly one (ignoring whitespace) */
function singleRoot(frag: DocumentFragment): HTMLElement | null {
  const nodes = [...frag.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent!.trim()));
  return nodes.length === 1 && nodes[0].nodeType === Node.ELEMENT_NODE ? (nodes[0] as HTMLElement) : null;
}

function findComment(root: Node, data: string): Comment | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if ((node as Comment).data === data) return node as Comment;
  return null;
}

function findText(root: Node, marker: string): Text | null {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent!.includes(marker)) return node as Text;
  return null;
}

/**
 * Make everything in `root` except the path to `slot` non-editable. The slot itself inherits the
 * editor's editability: a nested contenteditable="true" would become its own editing host, which
 * keeps the browser's focus when the cursor should move on.
 */
function lockAround(root: HTMLElement, slot: Node) {
  for (let node: Node = slot; node !== root && node.parentNode; node = node.parentNode) {
    for (const sibling of [...node.parentNode.childNodes]) {
      if (sibling === node) continue;
      if (sibling.nodeType === Node.ELEMENT_NODE) (sibling as HTMLElement).setAttribute("contenteditable", "false");
      else if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent!.trim()) {
        // Text the theme put around the slot (e.g. a non-breaking space before an icon)
        const wrap = root.ownerDocument.createElement("span");
        wrap.setAttribute("contenteditable", "false");
        sibling.replaceWith(wrap);
        wrap.append(sibling);
      }
    }
  }
}

function el(doc: Document, tag: string, className: string, text?: string): HTMLElement {
  const element = doc.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function sourceLabel(name: string, args: string) {
  return `${name}${args}`;
}

abstract class ComponentView implements NodeView {
  dom!: HTMLElement;
  contentDOM?: HTMLElement;
  protected result: ProbeResult | undefined;

  constructor(
    protected node: ProseNode,
    protected view: EditorView,
    protected getPos: () => number | undefined,
    protected env: EditorEnv,
  ) {
    this.result = this.call() ? env.probes.get(this.call()!) : undefined;
    this.render();
    this.dom.setAttribute(COMPONENT_ATTR, node.attrs.name || "tera");
    componentElements.set(this.dom, { getPos, view });
  }

  protected abstract call(): ProbeCall | null;
  protected abstract render(): void;

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type || node.attrs.name !== this.node.attrs.name || node.attrs.args !== this.node.attrs.args) return false;
    if (node.attrs.raw !== this.node.attrs.raw && !this.contentDOM) return false;
    // A probe result arrived since this was drawn: draw again
    const call = this.call();
    if (call && this.env.probes.get(call) !== this.result) return false;
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }): boolean {
    if (mutation.type === "selection") return !this.contentDOM;
    return !this.contentDOM || !this.contentDOM.contains(mutation.target) || mutation.target === this.contentDOM;
  }

  stopEvent(event: Event): boolean {
    // Clicks on the component's own (non-editable) parts open its settings, not a text selection
    return !!this.contentDOM && event.type === "mousedown" && !this.contentDOM.contains(event.target as Node);
  }
}

class BlockView extends ComponentView {
  protected call(): ProbeCall {
    return { kind: "block", name: this.node.attrs.name, args: this.node.attrs.args };
  }

  protected render() {
    const { doc } = this.env;
    const result = this.result;
    if (result?.slot) {
      const frag = fragment(doc, result.html);
      const comment = findComment(frag, SLOT_COMMENT)!;
      const slot = el(doc, "div", "zd-slot");
      comment.replaceWith(slot);
      const root = singleRoot(frag);
      if (root) this.dom = root;
      else {
        this.dom = el(doc, "div", "zd-wrap");
        this.dom.append(frag);
      }
      this.dom.classList.add("zd-component");
      lockAround(this.dom, slot);
      this.contentDOM = slot;
      return;
    }
    // Not editable in place (still rendering, or the theme transforms the body): show what it
    // renders, with the body editable underneath
    this.dom = el(doc, "div", "zd-component zd-fallback");
    const header = el(doc, "div", "zd-fallback-head");
    header.append(el(doc, "span", "zd-tag", `{% <${sourceLabel(this.node.attrs.name, this.node.attrs.args)}> %}`));
    this.dom.append(header);
    if (result?.html) this.dom.append(Object.assign(el(doc, "div", "zd-preview"), { innerHTML: result.html }));
    else if (result?.error) this.dom.append(el(doc, "div", "zd-error", result.error));
    else this.dom.append(el(doc, "div", "zd-pending", "Rendering…"));
    this.contentDOM = el(doc, "div", "zd-fallback-body");
    this.dom.append(this.contentDOM, el(doc, "div", "zd-tag zd-close", `{% </${this.node.attrs.name}> %}`));
    lockAround(this.dom, this.contentDOM);
  }
}

class TextView extends ComponentView {
  protected call(): ProbeCall {
    return { kind: "text", name: this.node.attrs.name, args: this.node.attrs.args };
  }

  protected render() {
    const { doc } = this.env;
    const result = this.result;
    const slot = el(doc, "span", "zd-text");
    if (result?.slot && result.marker) {
      const frag = fragment(doc, result.html);
      const text = findText(frag, result.marker)!;
      const [before, after] = text.textContent!.split(result.marker);
      text.replaceWith(doc.createTextNode(before), slot, doc.createTextNode(after));
      const root = singleRoot(frag);
      this.dom = root ?? el(doc, "span", "zd-wrap");
      if (!root) this.dom.append(frag);
    } else {
      this.dom = el(doc, "span", "zd-inline-fallback");
      this.dom.append(slot);
    }
    this.dom.classList.add("zd-component");
    lockAround(this.dom, slot);
    this.contentDOM = slot;
  }
}

class AtomView extends ComponentView {
  protected call(): ProbeCall | null {
    return this.node.attrs.name ? { kind: "atom", name: this.node.attrs.name, args: this.node.attrs.args } : null;
  }

  protected render() {
    const { doc } = this.env;
    const result = this.result;
    if (!this.node.attrs.name) {
      // Plain Tera: show the source
      this.dom = el(doc, "code", "zd-component zd-tera", this.node.attrs.raw);
      return;
    }
    this.dom = el(doc, "span", "zd-component zd-atom");
    if (result?.html) this.dom.innerHTML = result.html;
    else if (result?.error) this.dom.append(el(doc, "span", "zd-error", `${this.node.attrs.name}: ${result.error.split("\n")[0]}`));
    else this.dom.append(el(doc, "span", "zd-pending", `${this.node.attrs.name}…`));
    this.dom.addEventListener("click", () => this.env.openSettings(this.dom));
  }

  selectNode() {
    this.dom.classList.add("zd-selected");
  }

  deselectNode() {
    this.dom.classList.remove("zd-selected");
  }
}

class TeraBlockView extends ComponentView {
  protected call(): null {
    return null;
  }

  protected render() {
    this.dom = el(this.env.doc, "pre", "zd-component zd-tera zd-tera-block", this.node.attrs.raw);
  }
}

export function zolaViews(env: EditorEnv, nodes: ReturnType<typeof zolaNodes>) {
  return [
    $view(nodes.block, () => (node, view, getPos) => new BlockView(node, view, getPos as () => number | undefined, env)),
    $view(nodes.text, () => (node, view, getPos) => new TextView(node, view, getPos as () => number | undefined, env)),
    $view(nodes.atom, () => (node, view, getPos) => new AtomView(node, view, getPos as () => number | undefined, env)),
    $view(nodes.teraBlock, () => (node, view, getPos) => new TeraBlockView(node, view, getPos as () => number | undefined, env)),
    // Images: absolute paths are relative to the site's root, which the preview serves under /site
    $view(imageSchema.node, () => (node) => {
      const img = env.doc.createElement("img");
      const apply = (n: ProseNode) => {
        const src: string = n.attrs.src ?? "";
        img.src = src.startsWith("/") && !src.startsWith("//") ? `${env.siteUrl}${src}` : src;
        img.alt = n.attrs.alt ?? "";
        if (n.attrs.title) img.title = n.attrs.title;
      };
      apply(node);
      return {
        dom: img,
        update: (next: ProseNode) => {
          if (next.type !== node.type) return false;
          apply(next);
          return true;
        },
      };
    }),
  ];
}

/**
 * Enter inside an inline component's text (e.g. color's `text`) would split the paragraph and the
 * component with it. A component's text is one line: Enter moves the cursor after the component.
 */
export const inlineTextKeys = $prose(
  () =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.key !== "Enter") return false;
          const { $from } = view.state.selection;
          if ($from.parent.type.name !== "zola_text") return false;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, $from.after())));
          return true;
        },
      },
    }),
);

// When probe results arrive, give component nodes a fresh decoration so their views update
export const probeRefreshKey = new PluginKey<number>("zdrafts-probe-refresh");

export function probeRefresh(nodes: ReturnType<typeof zolaNodes>) {
  return $prose(
    () =>
      new Plugin<number>({
        key: probeRefreshKey,
        state: {
          init: () => 0,
          apply: (tr, value) => tr.getMeta(probeRefreshKey) ?? value,
        },
        props: {
          decorations(state) {
            const version = probeRefreshKey.getState(state) ?? 0;
            const decorations: Decoration[] = [];
            const names = [nodes.block.id, nodes.text.id, nodes.atom.id];
            state.doc.descendants((node, pos) => {
              if (names.includes(node.type.name)) {
                decorations.push(Decoration.node(pos, pos + node.nodeSize, { "data-zd-v": String(version) }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
  );
}
