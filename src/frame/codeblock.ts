// Code blocks drawn as the site publishes them: Zola highlights each block (a "code" probe, see
// src/zola/probe.ts), and its <pre> is shown as it is, with the editable code over it (CodeBlockView).
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";
import type { ProbeCall, ProbeResult } from "../zola/probe.ts";
import type { EditorEnv } from "./nodes.ts";

/** The fence's info string: the language and, after it, Zola's options (linenos, hl_lines=…) */
const infoString = (node: ProseNode) => [node.attrs.language, node.attrs.meta].filter(Boolean).join(" ");

const isRawTag = (node: ProseNode, tag: "raw" | "endraw") => (node.type.name === "zola_tera_block" || node.type.name === "zola_atom") && new RegExp(`^\\{%-?\\s*${tag}\\b`).test(String(node.attrs.raw ?? "").trim());

/** Whether the code block at `pos` is between {% raw %} and {% endraw %} in the page */
function inRaw(doc: ProseNode, pos: number): boolean {
  let raw = false;
  doc.nodesBetween(0, pos, (node) => {
    if (isRawTag(node, "raw")) raw = true;
    else if (isRawTag(node, "endraw")) raw = false;
    return true;
  });
  return raw;
}

const codeCall = (node: ProseNode, raw: boolean): ProbeCall => ({ kind: "code", name: infoString(node), args: node.textContent, raw });

/**
 * Code blocks keep the whole info string: Milkdown keeps only the language, which would drop
 * Zola's options (```rust, linenos, hl_lines=3-4) when the page is saved.
 */
export const codeBlockWithMeta = codeBlockSchema.extendSchema((schema) => (ctx) => {
  const spec = schema(ctx);
  return {
    ...spec,
    attrs: { ...spec.attrs, meta: { default: "" } },
    parseMarkdown: {
      ...spec.parseMarkdown,
      runner: (state, node, type) => {
        state.openNode(type, { language: String(node.lang ?? ""), meta: String(node.meta ?? "") });
        if (typeof node.value === "string" && node.value) state.addText(node.value);
        state.closeNode();
      },
    },
    toMarkdown: {
      ...spec.toMarkdown,
      runner: (state, node) => {
        state.addNode("code", undefined, node.content.firstChild?.text || "", { lang: node.attrs.language || null, meta: node.attrs.meta || null });
      },
    },
  };
});

/** Zola's highlighted HTML for a block, if it's for this code: its <pre> */
function highlighted(doc: Document, result: ProbeResult | undefined, text: string): HTMLElement | null {
  if (!result?.html) return null;
  const template = doc.createElement("template");
  template.innerHTML = result.html;
  const pre = template.content.querySelector("pre");
  const code = pre?.querySelector("code") ?? pre;
  if (!pre || !code) return null;
  // Line numbers aren't the code; Zola may end the code with a newline the editor doesn't keep
  const copy = code.cloneNode(true) as HTMLElement;
  copy.querySelectorAll(".giallo-ln, .z-ln, [class*='lineno']").forEach((number) => number.remove());
  return copy.textContent!.replace(/\n$/, "") === text.replace(/\n$/, "") ? (pre as HTMLElement) : null;
}

/** The <pre> in Zola's HTML for a block */
function zolaPre(doc: Document, result: ProbeResult): HTMLElement | null {
  const template = doc.createElement("template");
  template.innerHTML = result.html;
  return template.content.querySelector("pre");
}

/** Zola's <pre> look from the last highlighted block, for blocks not highlighted yet */
let lastPre: HTMLElement | null = null;

/**
 * A code block as Zola renders it: Zola's highlighted <pre> as it is, with the editable code laid
 * over it in the same place, its text transparent (the highlighted text shows through). While the
 * code changes, the editable text shows until Zola has highlighted the new code.
 */
class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private edit: HTMLElement;
  private shown: HTMLElement | null = null;
  private showing: ProbeResult | undefined;

  constructor(
    private node: ProseNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    private env: EditorEnv,
  ) {
    const { doc } = env;
    this.dom = doc.createElement("div");
    this.dom.className = "zd-code zd-unwrap";
    this.edit = doc.createElement("pre");
    this.contentDOM = doc.createElement("code");
    this.contentDOM.spellcheck = false;
    this.edit.append(this.contentDOM);
    this.dom.append(this.edit);
    this.edit.addEventListener("scroll", () => {
      if (this.shown) this.shown.scrollLeft = this.edit.scrollLeft;
    });
    this.render();
  }

  private render() {
    const call = codeCall(this.node, inRaw(this.view.state.doc, this.getPos() ?? 0));
    const result = this.env.probes.peek(call);
    const exact = highlighted(this.env.doc, result, this.node.textContent);
    // Not in raw in the page: Tera ran on the code, and Zola shows what it made of it. That's shown,
    // with the code as written under it to edit
    const changed = !exact && !call.raw && result?.html && !result.error ? zolaPre(this.env.doc, result) : null;
    const pre = exact ?? changed;
    if (exact) lastPre = exact;
    if (pre && result !== this.showing) {
      this.showing = result;
      this.shown?.remove();
      this.shown = this.env.doc.importNode(pre, true) as HTMLElement;
      this.shown.contentEditable = "false";
      // The editable layer is what's read out
      this.shown.setAttribute("aria-hidden", "true");
      this.shown.dataset.zdAdded = "aria-hidden";
      this.dom.prepend(this.shown);
    }
    // The editable layer looks like Zola's <pre> (the theme's padding, font, line height)
    const look = pre ?? this.shown ?? lastPre;
    for (const { name } of [...this.edit.attributes]) this.edit.removeAttribute(name);
    for (const [name, value] of look ? [...look.attributes].map((a) => [a.name, a.value]) : []) if (name !== "id" && name !== "aria-hidden" && name !== "contenteditable") this.edit.setAttribute(name, value);
    this.edit.classList.add("zd-editing", "zd-code-edit");
    this.dom.classList.toggle("zd-code-stale", !pre);
    this.dom.classList.toggle("zd-code-changed", !!changed);
    if (this.node.attrs.language) this.contentDOM.dataset.lang = this.node.attrs.language;
    else delete this.contentDOM.dataset.lang;
    requestAnimationFrame(() => this.align());
  }

  /** Line numbers and such before the code in Zola's <pre>: the editable text starts as far in */
  private align() {
    this.edit.style.paddingLeft = "";
    const first = this.shown && [...this.shown.querySelectorAll("code *, code")].flatMap((element) => [...element.childNodes]).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() && !(node.parentElement?.closest(".giallo-ln, .z-ln")));
    const editText = this.contentDOM.firstChild;
    if (!first || !editText || this.dom.classList.contains("zd-code-stale")) return;
    const at = (node: Node) => {
      const range = this.env.doc.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(1, node.textContent!.length));
      return range.getBoundingClientRect().left;
    };
    const shift = at(first) - at(editText);
    if (Math.abs(shift) > 0.5) this.edit.style.paddingLeft = `${parseFloat(getComputedStyle(this.edit).paddingLeft) + shift}px`;
    this.edit.style.caretColor = getComputedStyle(first.parentElement!).color;
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  // Zola's layer and the attributes are drawn here; the content is ProseMirror's
  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }) {
    if (mutation.type === "selection") return false;
    return !this.contentDOM.contains(mutation.target) || (mutation.type === "attributes" && mutation.target === this.contentDOM);
  }
}

export function codeBlocks(env: EditorEnv) {
  const plugin = $prose(
    () =>
      new Plugin({
        // A new highlight redraws the blocks: each carries the probes' version
        props: {
          decorations: (state) => {
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === "code_block") found.push(Decoration.node(pos, pos + node.nodeSize, { "data-zd-probes": String(env.probes.version) }));
              return node.type.name !== "code_block";
            });
            return DecorationSet.create(state.doc, found);
          },
        },
        // Ask Zola to highlight code blocks, and again once typing pauses
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const request = (v: EditorView) =>
            v.state.doc.descendants((node, pos) => {
              if (node.type.name !== "code_block") return true;
              env.probes.get(codeCall(node, inRaw(v.state.doc, pos)));
              return false;
            });
          request(view);
          return {
            update(v, previous) {
              if (v.state.doc === previous.doc) return;
              clearTimeout(timer);
              timer = setTimeout(() => request(v), 500);
            },
            destroy: () => clearTimeout(timer),
          };
        },
      }),
  );

  const view = $view(codeBlockSchema.node, () => (node, view, getPos) => new CodeBlockView(node, view, getPos, env));
  return [plugin, view];
}
