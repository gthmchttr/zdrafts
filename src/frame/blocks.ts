// Paragraphs, lists, task items and tables drawn as Zola (pulldown-cmark) writes them:
// - paragraphs in tight lists and in table cells have no <p>: they're text in the <li> or cell;
// - nor does a paragraph that's only a component whose HTML starts an HTML block (Zola renders
//   components into the Markdown before the Markdown, see startsHtmlBlock);
// - a task item starts with Zola's disabled checkbox (clicking it ticks the item);
// - a table's header row is in <thead>, its other rows in <tbody>, and a cell is aligned only
//   when its column says so.
// Elements that only exist for editing are marked zd-unwrap (they're not part of the page).
import { listItemSchema, paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { tableCellSchema, tableHeaderRowSchema, tableHeaderSchema, tableRowSchema, tableSchema } from "@milkdown/kit/preset/gfm";
import { DOMSerializer, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { Plugin } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet, type EditorView, type NodeView } from "@milkdown/kit/prose/view";
import { $prose, $view } from "@milkdown/kit/utils";
import { startsHtmlBlock } from "../markdown/zola-render.ts";
import type { EditorEnv } from "./nodes.ts";

const truthy = (value: unknown) => value === true || value === "true";

/** Whether a paragraph at `pos` is written without <p>: in a tight list's item, or in a table cell */
function bare(view: EditorView, pos: number | undefined): boolean {
  if (pos === undefined) return false;
  const $pos = view.state.doc.resolve(pos);
  const parent = $pos.parent;
  if (parent.type.name === "table_cell" || parent.type.name === "table_header") return true;
  if (parent.type.name !== "list_item" || $pos.depth < 2) return false;
  const list = $pos.node($pos.depth - 1);
  // A list is loose if blank lines separate its items or any item's blocks (CommonMark)
  if (truthy(list.attrs.spread)) return false;
  let loose = false;
  list.forEach((item) => (loose ||= truthy(item.attrs.spread)));
  return !loose;
}

/** Marked by standaloneComponents */
const standalone = (decorations: readonly Decoration[]) => decorations.some((decoration) => decoration.spec.bare);

class ParagraphView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private bare: boolean;

  constructor(
    private node: ProseNode,
    private view: EditorView,
    private getPos: () => number | undefined,
    decorations: readonly Decoration[],
  ) {
    this.bare = standalone(decorations) || bare(view, getPos());
    this.dom = this.contentDOM = view.dom.ownerDocument.createElement(this.bare ? "span" : "p");
    if (this.bare) this.dom.className = "zd-unwrap";
  }

  update(node: ProseNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type || (standalone(decorations) || bare(this.view, this.getPos())) !== this.bare) return false;
    this.node = node;
    return true;
  }
}

/** Paragraphs that are only a component whose HTML starts an HTML block, once it has rendered */
export function standaloneComponents(env: EditorEnv) {
  return $prose(
    () =>
      new Plugin({
        props: {
          decorations: (state) => {
            const found: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "paragraph") return true;
              const only = node.childCount === 1 ? node.firstChild! : null;
              // A component's HTML, or HTML written in the page (an HTML block, which Milkdown
              // keeps in a paragraph)
              const html =
                only?.type.name === "zola_atom" && only.attrs.name
                  ? env.probes.peek({ kind: "atom", name: only.attrs.name, args: only.attrs.args })?.html
                  : only?.type.name === "html"
                    ? String(only.attrs.value ?? "")
                    : undefined;
              if (html && startsHtmlBlock(html)) found.push(Decoration.node(pos, pos + node.nodeSize, { "data-zd-bare": "" }, { bare: true }));
              return false;
            });
            return DecorationSet.create(state.doc, found);
          },
        },
      }),
  );
}

/** A list item; a task item gets Zola's checkbox, which ticks it */
class ListItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private task: boolean;

  constructor(
    private node: ProseNode,
    private view: EditorView,
    private getPos: () => number | undefined,
  ) {
    const doc = view.dom.ownerDocument;
    const { dom } = DOMSerializer.renderSpec(doc, node.type.spec.toDOM!(node));
    this.dom = dom as HTMLElement;
    this.task = node.attrs.checked != null;
    if (!this.task) {
      this.contentDOM = this.dom;
      return;
    }
    this.dom.replaceChildren();
    // Zola: <li><input disabled="" type="checkbox" checked=""/> text</li>
    const box = doc.createElement("span");
    box.className = "zd-unwrap zd-task";
    box.contentEditable = "false";
    const input = doc.createElement("input");
    input.type = "checkbox";
    input.disabled = true;
    input.checked = node.attrs.checked === true;
    if (input.checked) input.setAttribute("checked", "");
    box.append(input);
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const pos = this.getPos();
      if (pos !== undefined) this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, checked: !this.node.attrs.checked }));
    });
    this.contentDOM = doc.createElement("div");
    this.contentDOM.className = "zd-unwrap";
    this.contentDOM.style.display = "contents";
    this.dom.append(box, " ", this.contentDOM);
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type || (node.attrs.checked != null) !== this.task || node.attrs.checked !== this.node.attrs.checked) return false;
    this.node = node;
    return true;
  }

  ignoreMutation(mutation: MutationRecord | { type: "selection"; target: Node }) {
    return mutation.type !== "selection" && !this.contentDOM.contains(mutation.target);
  }
}

export const zolaParagraphs = $view(paragraphSchema.node, () => (node, view, getPos, decorations) => new ParagraphView(node, view, getPos, decorations));
export const zolaListItems = $view(listItemSchema.node, () => (node, view, getPos) => new ListItemView(node, view, getPos));

/** A cell's attributes: aligned only when its column says so */
const cellAttrs = (node: ProseNode) => (node.attrs.alignment ? { style: `text-align: ${node.attrs.alignment}` } : {});

export const zolaTables = [
  tableSchema.extendSchema((schema) => (ctx) => ({ ...schema(ctx), toDOM: () => ["table", 0] })),
  // ProseMirror needs each row in its own element: the header in <thead>, every other row in a <tbody>
  tableHeaderRowSchema.extendSchema((schema) => (ctx) => ({ ...schema(ctx), toDOM: () => ["thead", ["tr", 0]] })),
  tableRowSchema.extendSchema((schema) => (ctx) => ({ ...schema(ctx), toDOM: () => ["tbody", ["tr", 0]] })),
  tableHeaderSchema.extendSchema((schema) => (ctx) => ({ ...schema(ctx), toDOM: (node) => ["th", cellAttrs(node), 0] })),
  tableCellSchema.extendSchema((schema) => (ctx) => ({ ...schema(ctx), toDOM: (node) => ["td", cellAttrs(node), 0] })),
].flat();
