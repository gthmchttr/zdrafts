// Footnotes drawn as Zola renders them (components/markdown/src/markdown.rs and pulldown-cmark):
// - references are numbered by their first use: [1] linking to the note;
// - with `bottom_footnotes`, the notes go in a list at the end of the content, each with links back
//   to its references; they're still edited where they're written, which is marked zd-editing;
// - without it, each note is where it's written, after its number.
import { footnoteDefinitionSchema, footnoteReferenceSchema } from "@milkdown/kit/preset/gfm";
import { DOMSerializer, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey, type EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";
import type { RenderInfo } from "../markdown/zola-render.ts";

interface Numbers {
  /** label → its number, by first reference */
  number: Map<string, number>;
  /** label → how many references */
  count: Map<string, number>;
  /** a reference's position → which of its label's references it is (1, 2…) */
  nth: Map<number, number>;
}

function numbers(doc: ProseNode, bottom: boolean): Numbers {
  const result: Numbers = { number: new Map(), count: new Map(), nth: new Map() };
  doc.descendants((node, pos) => {
    const reference = node.type.name === "footnote_reference";
    // pulldown-cmark (no bottom_footnotes) numbers notes by whichever comes first, reference or note
    if (!reference && !(node.type.name === "footnote_definition" && !bottom)) return true;
    const label = String(node.attrs.label);
    if (!result.number.has(label)) result.number.set(label, result.number.size + 1);
    if (reference) {
      result.count.set(label, (result.count.get(label) ?? 0) + 1);
      result.nth.set(pos, result.count.get(label)!);
    }
    return true;
  });
  return result;
}

const key = new PluginKey<Numbers>("zdrafts-footnotes");

class ReferenceView implements NodeView {
  dom: HTMLElement;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined, info: RenderInfo) {
    const doc = view.dom.ownerDocument;
    const label = String(node.attrs.label);
    const found = key.getState(view.state)!;
    const n = found.number.get(label) ?? 0;
    this.dom = doc.createElement("sup");
    this.dom.className = "footnote-reference";
    const link = doc.createElement("a");
    if (info.markdown.bottomFootnotes) {
      this.dom.id = `fr-${label}-${found.nth.get(getPos() ?? -1) ?? 1}`;
      link.href = `${info.pageUrl}#fn-${label}`;
      link.textContent = `[${n}]`;
    } else {
      link.setAttribute("href", `#${label}`);
      link.textContent = String(n);
    }
    this.dom.append(link);
  }

  // Numbers change with references elsewhere: draw again every time
  update() {
    return false;
  }
}

class DefinitionView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;

  constructor(node: ProseNode, view: EditorView, info: RenderInfo) {
    const doc = view.dom.ownerDocument;
    const label = String(node.attrs.label);
    if (info.markdown.bottomFootnotes) {
      // Shown at the end (footnotesSection); here only to edit it
      this.dom = doc.createElement("div");
      this.dom.className = "zd-editing zd-footnote";
      this.dom.dataset.label = `[^${label}]`;
      this.contentDOM = this.dom;
      return;
    }
    // <div class="footnote-definition" id="x"><sup class="footnote-definition-label">1</sup>…</div>
    this.dom = doc.createElement("div");
    this.dom.className = "footnote-definition";
    this.dom.id = label;
    const number = doc.createElement("sup");
    number.className = "footnote-definition-label";
    number.contentEditable = "false";
    number.textContent = String(key.getState(view.state)!.number.get(label) ?? 0);
    this.contentDOM = doc.createElement("div");
    this.contentDOM.className = "zd-unwrap";
    this.contentDOM.style.display = "contents";
    this.dom.append(number, this.contentDOM);
  }

  update() {
    return false;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }) {
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }
}

/** With bottom_footnotes: the notes as Zola lists them at the end of the content */
function footnotesSection(state: EditorState, view: EditorView, info: RenderInfo): HTMLElement | null {
  const found = key.getState(state)!;
  const notes: { label: string; node: ProseNode }[] = [];
  state.doc.descendants((node) => {
    if (node.type.name === "footnote_definition" && found.number.has(String(node.attrs.label))) notes.push({ label: String(node.attrs.label), node });
    return node.type.name !== "footnote_definition";
  });
  if (!notes.length) return null;
  notes.sort((a, b) => found.number.get(a.label)! - found.number.get(b.label)!);
  const doc = view.dom.ownerDocument;
  const serializer = DOMSerializer.fromSchema(state.schema);
  const section = doc.createElement("section");
  section.className = "footnotes";
  section.contentEditable = "false";
  const list = doc.createElement("ol");
  list.className = "footnotes-list";
  for (const { label, node } of notes) {
    const item = doc.createElement("li");
    item.id = `fn-${label}`;
    item.append(serializer.serializeFragment(node.content, { document: doc }));
    // The links back to its references, in its last paragraph
    const back: Node[] = [];
    for (let u = 1; u <= (found.count.get(label) ?? 0); u++) {
      const link = doc.createElement("a");
      link.href = `${info.pageUrl}#fr-${label}-${u}`;
      link.textContent = `↩${u === 1 ? "" : u}`;
      back.push(doc.createTextNode(" "), link);
    }
    const paragraphs = item.querySelectorAll(":scope > p");
    (paragraphs[paragraphs.length - 1] ?? item).append(...back);
    list.append(item);
  }
  section.append(list);
  return section;
}

export function zolaFootnotes(info: RenderInfo) {
  const plugin = $prose(
    () =>
      new Plugin<Numbers>({
        key,
        state: {
          init: (_, state) => numbers(state.doc, info.markdown.bottomFootnotes),
          apply: (tr, value, _, state) => (tr.docChanged ? numbers(state.doc, info.markdown.bottomFootnotes) : value),
        },
        props: {
          decorations(state) {
            if (!info.markdown.bottomFootnotes) return null;
            // Redrawn when the notes or their references change
            const notes: string[] = [];
            state.doc.descendants((node) => {
              if (node.type.name === "footnote_definition") notes.push(`${node.attrs.label}:${node.content.toString()}`);
              return node.type.name !== "footnote_definition";
            });
            const signature = JSON.stringify([[...key.getState(state)!.count], notes]);
            return DecorationSet.create(state.doc, [
              Decoration.widget(state.doc.content.size, (view) => footnotesSection(view.state, view, info) ?? view.dom.ownerDocument.createTextNode(""), {
                key: `footnotes:${signature}`,
                side: 1,
              }),
            ]);
          },
        },
      }),
  );
  return [
    plugin,
    $view(footnoteReferenceSchema.node, () => (node, view, getPos) => new ReferenceView(node, view, getPos, info)),
    $view(footnoteDefinitionSchema.node, () => (node, view) => new DefinitionView(node, view, info)),
  ];
}
