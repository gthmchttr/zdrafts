// Formatting that works in any theme, written as HTML with inline styles: text colour and
// highlight, underline and friends on text; alignment, boxes, columns and collapsible sections on
// blocks. A block's wrapper <div> is reused when there is one, so repeated changes don't nest.
import type { Mark, Node as ProseNode } from "@milkdown/kit/prose/model";
import { NodeSelection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { getStyle, setStyles } from "../markdown/html.ts";

// --- text ---------------------------------------------------------------------------------

/** Readable on light and dark themes */
export const TEXT_COLORS = [
  { name: "Red", value: "#e5484d" },
  { name: "Orange", value: "#f76b15" },
  { name: "Yellow", value: "#d6a400" },
  { name: "Green", value: "#30a46c" },
  { name: "Blue", value: "#0090ff" },
  { name: "Purple", value: "#8e4ec6" },
  { name: "Gray", value: "#8b8d98" },
];

/** Translucent, so the text keeps its colour on any background */
export const HIGHLIGHTS = [
  { name: "Yellow", value: "rgba(255, 213, 0, 0.35)" },
  { name: "Green", value: "rgba(48, 164, 108, 0.3)" },
  { name: "Blue", value: "rgba(0, 144, 255, 0.28)" },
  { name: "Purple", value: "rgba(142, 78, 198, 0.3)" },
  { name: "Red", value: "rgba(229, 72, 77, 0.3)" },
  { name: "Gray", value: "rgba(139, 141, 152, 0.3)" },
];

/** Tags offered for text, with what they're for */
export const TEXT_TAGS = [
  { tag: "u", label: "Underline", icon: "underline" as const },
  { tag: "sup", label: "Superscript", icon: "superscript" as const },
  { tag: "sub", label: "Subscript", icon: "subscript" as const },
  { tag: "kbd", label: "Keyboard key", icon: "keyboard" as const },
];

const htmlMarks = (state: EditorState, from: number, to: number, test: (mark: Mark) => boolean): Mark[] => {
  const found: Mark[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    for (const mark of node.marks) if (mark.type.name === "html_inline" && test(mark) && !found.includes(mark)) found.push(mark);
  });
  return found;
};

const isColor = (mark: Mark) => mark.attrs.tag === "span" && getStyle(mark.attrs.attrs, "color") !== null;
const isHighlight = (mark: Mark) => mark.attrs.tag === "mark";

/** Colour the selected text (null removes colour) */
export function setTextColor(view: EditorView, color: string | null) {
  replaceInline(view, isColor, color ? { tag: "span", attrs: ` style="color: ${color}"` } : null);
}

/** Highlight the selected text (null removes highlighting; "" is the browser's own <mark> look) */
export function setHighlight(view: EditorView, background: string | null) {
  replaceInline(view, isHighlight, background === null ? null : { tag: "mark", attrs: background ? ` style="background-color: ${background}"` : "" });
}

function replaceInline(view: EditorView, existing: (mark: Mark) => boolean, next: { tag: string; attrs: string } | null) {
  const { from, to } = view.state.selection;
  if (from === to) return;
  const type = view.state.schema.marks.html_inline;
  let tr = view.state.tr;
  for (const mark of htmlMarks(view.state, from, to, existing)) tr = tr.removeMark(from, to, mark);
  if (next) tr = tr.addMark(from, to, type.create({ ...next, close: `</${next.tag}>` }));
  view.dispatch(tr);
}

/** Whether all of the selection has this tag */
export function hasTag(state: EditorState, tag: string): boolean {
  const { from, to, empty } = state.selection;
  if (empty) return false;
  let all = true;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText && !node.marks.some((mark) => mark.type.name === "html_inline" && mark.attrs.tag === tag)) all = false;
  });
  return all;
}

export function toggleTag(view: EditorView, tag: string) {
  const { from, to } = view.state.selection;
  if (from === to) return;
  if (hasTag(view.state, tag)) {
    let tr = view.state.tr;
    for (const mark of htmlMarks(view.state, from, to, (m) => m.attrs.tag === tag)) tr = tr.removeMark(from, to, mark);
    view.dispatch(tr);
  } else {
    view.dispatch(view.state.tr.addMark(from, to, view.state.schema.marks.html_inline.create({ tag, attrs: "", close: `</${tag}>` })));
  }
}

// --- blocks -------------------------------------------------------------------------------

export interface Block {
  pos: number;
  node: ProseNode;
}

export const ALIGNMENTS = ["left", "center", "right", "justify"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

const BOX_STYLE = { padding: "1rem 1.25rem", "border-radius": "8px" };
export const BOXES = {
  border: { label: "Border", icon: "box-border" as const, styles: { ...BOX_STYLE, border: "1px solid currentColor", background: null } },
  dashed: { label: "Dashed border", icon: "box-dashed" as const, styles: { ...BOX_STYLE, border: "1px dashed currentColor", background: null } },
  shaded: { label: "Shaded box", icon: "box-shaded" as const, styles: { ...BOX_STYLE, border: null, background: "rgba(127, 127, 127, 0.12)" } },
};
export type BoxKind = keyof typeof BOXES;
const NO_BOX = { padding: null, "border-radius": null, border: null, background: null };

const GRID = "display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 1.5rem";

const isDiv = (node: ProseNode) => node.type.name === "html_block" && node.attrs.tag === "div";
const isGrid = (node: ProseNode) => isDiv(node) && getStyle(node.attrs.attrs, "display") === "grid";

/** The block the block actions act on: a selected block, or the one the cursor is in */
export function currentBlock(state: EditorState): Block | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.isBlock) return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    if (["doc", "zola_block", "html_block"].includes(parent.type.name)) return { pos: $from.before(depth), node: $from.node(depth) };
  }
  return null;
}

/** The <div> that styles this block: the block itself, or a div around only it (not a grid) */
export function styleWrapper(state: EditorState, block: Block): Block | null {
  if (isDiv(block.node) && !isGrid(block.node)) return block;
  const $pos = state.doc.resolve(block.pos);
  if ($pos.depth > 0) {
    const parent = $pos.parent;
    if (isDiv(parent) && !isGrid(parent) && parent.childCount === 1) return { pos: $pos.before(), node: parent };
  }
  return null;
}

export function blockStyle(state: EditorState, block: Block, property: string): string | null {
  const wrapper = styleWrapper(state, block);
  return wrapper ? getStyle(wrapper.node.attrs.attrs, property) : null;
}

/** Change style properties around a block: update its wrapper, add one, or drop one left empty */
export function setBlockStyles(view: EditorView, block: Block, styles: Record<string, string | null>) {
  const { state } = view;
  const wrapper = styleWrapper(state, block);
  const schema = state.schema;
  if (wrapper) {
    const attrs = setStyles(wrapper.node.attrs.attrs, styles);
    // A plain <div> around one block does nothing: unwrap it (but keep a column of a grid)
    const $pos = state.doc.resolve(wrapper.pos);
    const inGrid = $pos.depth > 0 && isGrid($pos.parent);
    if (!attrs.trim() && !inGrid) view.dispatch(state.tr.replaceWith(wrapper.pos, wrapper.pos + wrapper.node.nodeSize, wrapper.node.content).scrollIntoView());
    else view.dispatch(state.tr.setNodeMarkup(wrapper.pos, undefined, { ...wrapper.node.attrs, attrs }));
    return;
  }
  const attrs = setStyles("", styles);
  if (!attrs.trim()) return;
  const div = schema.nodes.html_block.create({ tag: "div", attrs, close: "</div>" }, block.node);
  view.dispatch(state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, div).scrollIntoView());
}

export function setAlignment(view: EditorView, block: Block, alignment: Alignment) {
  setBlockStyles(view, block, { "text-align": alignment === "left" ? null : alignment });
}

export function boxKind(state: EditorState, block: Block): BoxKind | null {
  const border = blockStyle(state, block, "border");
  if (border?.includes("dashed")) return "dashed";
  if (border) return "border";
  return blockStyle(state, block, "background") ? "shaded" : null;
}

export function setBox(view: EditorView, block: Block, kind: BoxKind | null) {
  setBlockStyles(view, block, kind ? BOXES[kind].styles : NO_BOX);
}

/** The grid around a block's column, if the block is in one */
export function columnsOf(state: EditorState, block: Block): { grid: Block; column: Block } | null {
  const $pos = state.doc.resolve(block.pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    const parent = $pos.node(depth - 1);
    if (isDiv(node) && isGrid(parent)) return { grid: { pos: $pos.before(depth - 1), node: parent }, column: { pos: $pos.before(depth), node } };
  }
  return null;
}

/** Put a block in the first of `count` side-by-side columns (they stack on narrow screens) */
export function makeColumns(view: EditorView, block: Block, count: number) {
  const { schema } = view.state;
  const column = (content: ProseNode) => schema.nodes.html_block.create({ tag: "div", attrs: "", close: "</div>" }, content);
  const columns = [column(block.node), ...Array.from({ length: count - 1 }, () => column(schema.nodes.paragraph.create()))];
  const grid = schema.nodes.html_block.create({ tag: "div", attrs: ` style="${GRID}"`, close: "</div>" }, columns);
  const tr = view.state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, grid);
  // Into the new second column, ready to type
  const second = block.pos + 1 + columns[0].nodeSize + 1;
  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(second + 1))).scrollIntoView());
}

export function addColumn(view: EditorView, block: Block) {
  const found = columnsOf(view.state, block);
  if (!found) return;
  const { schema } = view.state;
  const end = found.grid.pos + found.grid.node.nodeSize - 1;
  const column = schema.nodes.html_block.create({ tag: "div", attrs: "", close: "</div>" }, schema.nodes.paragraph.create());
  const tr = view.state.tr.insert(end, column);
  view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2))).scrollIntoView());
}

/** Remove the column the block is in; with one column left, the grid goes too */
export function removeColumn(view: EditorView, block: Block) {
  const found = columnsOf(view.state, block);
  if (!found) return;
  const { grid, column } = found;
  if (grid.node.childCount <= 2) {
    // Keep the other column's content (and this one's, if it has any)
    const kept: ProseNode[] = [];
    grid.node.forEach((col) => {
      if (col !== column.node || col.textContent.trim()) col.forEach((child) => kept.push(child));
    });
    view.dispatch(view.state.tr.replaceWith(grid.pos, grid.pos + grid.node.nodeSize, kept).scrollIntoView());
  } else {
    view.dispatch(view.state.tr.delete(column.pos, column.pos + column.node.nodeSize).scrollIntoView());
  }
}

/** Turn columns back into blocks one after another */
export function removeColumns(view: EditorView, block: Block) {
  const found = columnsOf(view.state, block);
  if (!found) return;
  const kept: ProseNode[] = [];
  found.grid.node.forEach((col) => col.forEach((child) => kept.push(child)));
  view.dispatch(view.state.tr.replaceWith(found.grid.pos, found.grid.pos + found.grid.node.nodeSize, kept).scrollIntoView());
}

/** The <details> a block is in, if any */
export function detailsOf(state: EditorState, block: Block): Block | null {
  if (block.node.type.name === "html_block" && block.node.attrs.tag === "details") return block;
  const $pos = state.doc.resolve(block.pos);
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === "html_block" && node.attrs.tag === "details") return { pos: $pos.before(depth), node };
  }
  return null;
}

const escapeHtml = (text: string) => text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

export function makeCollapsible(view: EditorView, block: Block, title = "Details") {
  const details = view.state.schema.nodes.html_block.create({ tag: "details", attrs: "", close: "</details>", summary: `<summary>${escapeHtml(title)}</summary>` }, block.node);
  view.dispatch(view.state.tr.replaceWith(block.pos, block.pos + block.node.nodeSize, details).scrollIntoView());
}

export function setCollapsibleTitle(view: EditorView, details: Block, title: string) {
  view.dispatch(view.state.tr.setNodeMarkup(details.pos, undefined, { ...details.node.attrs, summary: `<summary>${escapeHtml(title)}</summary>` }));
}

/** Replace an HTML element with its content */
export function unwrap(view: EditorView, element: Block) {
  view.dispatch(view.state.tr.replaceWith(element.pos, element.pos + element.node.nodeSize, element.node.content).scrollIntoView());
}
