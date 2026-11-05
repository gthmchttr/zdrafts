// ProseMirror nodes for Zola's Tera syntax, and node views that draw them with the theme's real
// markup (from probes), so components look as published and their content is editable in place.
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
  /** A node as Markdown, once the editor is up (for probing a component with its real body) */
  markdown?: (node: ProseNode) => string;
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
    // source: the component as written, while its body isn't edited (not written back: Markdown is)
    attrs: { name: { default: "" }, args: { default: "" }, open: { default: null }, close: { default: null }, source: { default: null } },
    parseDOM: [],
    toDOM: (node) => ["div", { [COMPONENT_ATTR]: node.attrs.name }, 0],
    parseMarkdown: {
      match: (node) => node.type === "zolaBlock",
      runner: (state, node, type) => {
        const { name, args, open, close, source } = node as unknown as { name: string; args: string; open?: string; close?: string; source?: string };
        state.openNode(type, { name, args, open: open ?? null, close: close ?? null, source: source ?? null });
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
  // Whitespace between tags is one space, as in HTML (components render with white-space: normal,
  // not the editor's pre-wrap, see frame.css): a space between inline elements still shows
  const walker = doc.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent!.trim() && node.textContent!.includes("\n")) node.textContent = " ";
  }
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
        wrap.className = "zd-unwrap";
        wrap.setAttribute("contenteditable", "false");
        sibling.replaceWith(wrap);
        wrap.append(sibling);
      }
    }
  }
}

/** Attributes only the editor sets: kept when taking the site's from Zola's markup */
const isEditorAttribute = (name: string) => name === "contenteditable" || name.startsWith("data-zd");

/**
 * Take attribute values from `real` (a component rendered with its real body) onto `drawn` (the
 * same component drawn around the editable `slot`): templates may derive them from the body (an
 * id hashed from it). Elements are matched outside the body: before it from the start, after it
 * from the end; only where tags agree.
 */
function adoptAttributes(drawn: Element, real: Element, slot: Element) {
  if (drawn.tagName !== real.tagName) return;
  for (const { name } of [...drawn.attributes]) if (!isEditorAttribute(name) && name !== "class" && !real.hasAttribute(name)) drawn.removeAttribute(name);
  for (const { name, value } of [...real.attributes]) {
    if (name === "class") {
      const ours = [...drawn.classList].filter((token) => token.startsWith("zd-"));
      drawn.setAttribute("class", [value, ...ours].join(" ").trim());
    } else if (!isEditorAttribute(name)) drawn.setAttribute(name, value);
  }
  adoptChildren(drawn, real, slot);
}

/** adoptAttributes for the children of `drawn` and `real` */
function adoptChildren(drawn: Element, real: Element, slot: Element) {
  const ours = [...drawn.children].filter((child) => !child.classList.contains("zd-unwrap"));
  const theirs = [...real.children];
  const at = ours.findIndex((child) => child === slot || child.contains(slot));
  const pairs: [Element, Element][] =
    at < 0
      ? ours.length === theirs.length
        ? ours.map((child, i) => [child, theirs[i]])
        : []
      : [
          ...ours.slice(0, at).map((child, i): [Element, Element] => [child, theirs[i]]),
          ...ours.slice(at + 1).map((child, i): [Element, Element] => [child, theirs[theirs.length - (ours.length - at - 1) + i]]),
          ...(ours[at] !== slot ? [[ours[at], theirs[at]] as [Element, Element]] : []),
        ];
  for (const [mine, other] of pairs) if (mine && other) adoptAttributes(mine, other, slot);
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

/**
 * Tera that renders nothing (raw's tags, comments, set, import): shown only to edit, it isn't part
 * of the page as built
 */
const silentTera = (raw: string) => /^\{#|^\{%-?\s*(raw|endraw|set|set_global|import)\b/.test(raw.trim());

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
        // More than one element: a wrapper that takes no part in layout
        this.dom = el(doc, "div", "zd-wrap zd-unwrap");
        this.dom.style.display = "contents";
        this.dom.append(frag);
      }
      this.dom.classList.add("zd-component");
      lockAround(this.dom, slot);
      this.contentDOM = slot;
      this.adoptReal();
      return;
    }
    // Not editable in place (still rendering, or the theme transforms the body): what Zola renders
    // for it, body and all, and under it the body to edit (which isn't part of the page as built)
    this.dom = el(doc, "div", "zd-component zd-fallback zd-unwrap");
    this.preview = el(doc, "div", "zd-preview zd-unwrap");
    this.preview.contentEditable = "false";
    const editing = el(doc, "div", "zd-editing zd-fallback-edit");
    const header = el(doc, "div", "zd-fallback-head");
    header.append(el(doc, "span", "zd-tag", `{% <${sourceLabel(this.node.attrs.name, this.node.attrs.args)}> %}`));
    this.contentDOM = el(doc, "div", "zd-fallback-body");
    editing.append(header, this.contentDOM, el(doc, "div", "zd-tag zd-close", `{% </${this.node.attrs.name}> %}`));
    this.dom.append(this.preview, editing);
    this.showPreview();
    lockAround(this.dom, this.contentDOM);
  }

  // Set while render() runs from the base constructor: declared, not initialized, or initializing
  // them after it would undo that
  declare private preview: HTMLElement | null | undefined;
  declare private previewResult: ProbeResult | undefined;
  declare private adoptTimer: ReturnType<typeof setTimeout> | undefined;

  /** The call with its real body, rendered by Zola: the attributes it gives the component's markup */
  private adoptReal() {
    const source = this.env.markdown?.(this.node);
    const real = source ? this.env.probes.get({ kind: "source", name: "block", args: source.trim() }) : undefined;
    if (!real?.html || real.error || !this.contentDOM) return;
    const frag = fragment(this.env.doc, real.html);
    const root = singleRoot(frag);
    if (root && !this.dom.classList.contains("zd-wrap")) adoptAttributes(this.dom, root, this.contentDOM);
    else if (!root && this.dom.classList.contains("zd-wrap")) {
      const holder = this.env.doc.createElement("div");
      holder.append(frag);
      adoptChildren(this.dom, holder, this.contentDOM);
    }
  }

  /** The whole call, as written, rendered by Zola */
  private showPreview() {
    if (!this.preview) return;
    const { doc } = this.env;
    const source = this.env.markdown?.(this.node);
    const result = source ? this.env.probes.get({ kind: "source", name: "block", args: source.trim() }) : undefined;
    if (result === this.previewResult && this.preview.childNodes.length) return;
    this.previewResult = result;
    if (result?.html) this.preview.replaceChildren(fragment(doc, result.html));
    else if (result?.error) this.preview.replaceChildren(el(doc, "div", "zd-error", result.error));
    else this.preview.replaceChildren(el(doc, "div", "zd-pending zd-editing", "Rendering…"));
  }

  update(node: ProseNode): boolean {
    if (!this.preview) {
      if (!super.update(node)) return false;
      // Its real body changed, or Zola rendered it: take the attributes again (once typing pauses)
      clearTimeout(this.adoptTimer);
      this.adoptTimer = setTimeout(() => this.adoptReal(), 800);
      return true;
    }
    // Shown as Zola renders it: the body changed, or Zola has rendered it
    if (node.type !== this.node.type || node.attrs.name !== this.node.attrs.name || node.attrs.args !== this.node.attrs.args) return false;
    const call = this.call();
    if (this.env.probes.get(call) !== this.result && this.env.probes.get(call)?.slot) return false;
    this.node = node;
    this.showPreview();
    return true;
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
    if (this.node.attrs.name) return { kind: "atom", name: this.node.attrs.name, args: this.node.attrs.args };
    // Plain Tera, rendered as Zola renders it in the sentence; not Tera that renders nothing
    return silentTera(this.node.attrs.raw) ? null : { kind: "source", name: "inline", args: this.node.attrs.raw };
  }

  protected render() {
    const { doc } = this.env;
    const result = this.result;
    if (!this.node.attrs.name) {
      const raw: string = this.node.attrs.raw;
      if (result?.html !== undefined && !result.error) {
        // Tera in a sentence (a component with a body, an expression): as Zola renders it
        this.dom = el(doc, "span", "zd-component zd-tera zd-unwrap");
        this.dom.style.display = "contents";
        this.dom.append(fragment(doc, result.html));
        return;
      }
      // Its source: Tera that renders nothing, or not rendered (yet)
      this.dom = el(doc, "code", `zd-component zd-tera${silentTera(raw) ? " zd-editing" : ""}`, raw);
      return;
    }
    // The wrapper takes no part in layout: what shows is the component's own markup
    this.dom = el(doc, "span", "zd-component zd-atom zd-unwrap");
    if (result?.html) this.dom.append(fragment(doc, result.html));
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
    this.dom = el(this.env.doc, "pre", `zd-component zd-tera zd-tera-block${silentTera(this.node.attrs.raw) ? " zd-editing" : ""}`, this.node.attrs.raw);
  }
}

export function zolaViews(env: EditorEnv, nodes: ReturnType<typeof zolaNodes>) {
  return [
    $view(nodes.block, () => (node, view, getPos) => new BlockView(node, view, getPos as () => number | undefined, env)),
    $view(nodes.text, () => (node, view, getPos) => new TextView(node, view, getPos as () => number | undefined, env)),
    $view(nodes.atom, () => (node, view, getPos) => new AtomView(node, view, getPos as () => number | undefined, env)),
    $view(nodes.teraBlock, () => (node, view, getPos) => new TeraBlockView(node, view, getPos as () => number | undefined, env)),
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
