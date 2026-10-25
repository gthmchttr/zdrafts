// Code blocks drawn as the site publishes them: Zola highlights each block (a "code" probe, see
// src/zola/probe.ts) and its colours are laid over the editable code as decorations. While the
// code changes, the last colours move along with the text until Zola has highlighted the new code.
import { codeBlockSchema } from "@milkdown/kit/preset/commonmark";
import type { Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";
import type { ProbeCall, ProbeResult } from "../zola/probe.ts";
import { probeRefreshKey, type EditorEnv } from "./nodes.ts";

const codeCall = (node: ProseNode): ProbeCall => ({ kind: "code", name: String(node.attrs.language ?? ""), args: node.textContent });

interface Highlight {
  /** <pre> and <code> attributes (Zola's class and colours) */
  pre: [string, string][];
  code: [string, string][];
  /** Coloured ranges, as offsets into the code */
  spans: { from: number; to: number; style: string }[];
}

const parsed = new WeakMap<ProbeResult, Highlight | null>();

/** Read Zola's highlighted HTML for a code block whose text is `text` */
function highlight(result: ProbeResult, text: string): Highlight | null {
  if (parsed.has(result)) return parsed.get(result)!;
  let value: Highlight | null = null;
  const doc = new DOMParser().parseFromString(result.html, "text/html");
  const pre = doc.querySelector("pre");
  const code = pre?.querySelector("code") ?? pre;
  if (pre && code) {
    const spans: Highlight["spans"] = [];
    let offset = 0;
    const walker = doc.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      const styled = node.parentElement?.closest("[style]");
      if (styled && styled !== pre && code.contains(styled) && length) spans.push({ from: offset, to: offset + length, style: styled.getAttribute("style")! });
      offset += length;
    }
    // Zola may end the code with a newline the editor doesn't keep
    if (code.textContent!.replace(/\n$/, "") === text.replace(/\n$/, "")) {
      const attrs = (element: Element) => [...element.attributes].map((a): [string, string] => [a.name, a.value]);
      value = { pre: attrs(pre), code: code === pre ? [] : attrs(code), spans };
    }
  }
  parsed.set(result, value);
  return value;
}

/** Zola's <pre> look from the last highlighted block, for blocks not highlighted yet */
let lastLook: Pick<Highlight, "pre" | "code"> | null = null;

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private look = "";

  constructor(
    private node: ProseNode,
    private env: EditorEnv,
  ) {
    this.dom = env.doc.createElement("pre");
    this.contentDOM = env.doc.createElement("code");
    this.dom.append(this.contentDOM);
    this.render();
  }

  private render() {
    const result = this.env.probes.peek(codeCall(this.node));
    const found = result?.html ? highlight(result, this.node.textContent) : null;
    if (found) lastLook = found;
    const look = found ?? lastLook;
    const key = JSON.stringify([look, this.node.attrs.language]);
    if (key === this.look) return;
    this.look = key;
    for (const { name } of [...this.dom.attributes]) this.dom.removeAttribute(name);
    for (const { name } of [...this.contentDOM.attributes]) this.contentDOM.removeAttribute(name);
    for (const [name, value] of look?.pre ?? []) this.dom.setAttribute(name, value);
    for (const [name, value] of look?.code ?? []) this.contentDOM.setAttribute(name, value);
    this.dom.classList.add("zd-code");
    this.contentDOM.spellcheck = false;
    this.dom.dataset.language = this.node.attrs.language || "";
    if (this.node.attrs.language) this.contentDOM.dataset.lang = this.node.attrs.language;
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  // Decorations change on every highlight; the content is ProseMirror's
  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }) {
    return mutation.type === "attributes" && mutation.target === this.dom;
  }
}

const key = new PluginKey<DecorationSet>("zdrafts-code-highlight");

export function codeBlocks(env: EditorEnv) {
  const decorate = (doc: ProseNode, previous: DecorationSet): DecorationSet => {
    let set = previous;
    doc.descendants((node, pos) => {
      if (node.type.name !== "code_block") return true;
      const result = env.probes.peek(codeCall(node));
      const found = result?.html ? highlight(result, node.textContent) : null;
      if (found) {
        const start = pos + 1;
        set = set.remove(set.find(start, pos + node.nodeSize - 1));
        set = set.add(doc, found.spans.map((span) => Decoration.inline(start + span.from, start + span.to, { style: span.style })));
      }
      return false;
    });
    return set;
  };

  const plugin = $prose(
    () =>
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => decorate(state.doc, DecorationSet.empty),
          apply(tr, set) {
            const mapped = set.map(tr.mapping, tr.doc);
            return tr.docChanged || tr.getMeta(probeRefreshKey) !== undefined ? decorate(tr.doc, mapped) : mapped;
          },
        },
        props: { decorations: (state) => key.getState(state) },
        // Ask Zola to highlight code blocks once typing pauses
        view(view) {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const request = (v: EditorView) =>
            v.state.doc.descendants((node) => {
              if (node.type.name !== "code_block") return true;
              env.probes.get(codeCall(node));
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

  const view = $view(codeBlockSchema.node, () => (node) => new CodeBlockView(node, env));
  return [plugin, view];
}
