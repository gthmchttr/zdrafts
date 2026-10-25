// Menus on the page: a formatting toolbar over selected text, and a context menu (right click; Shift
// + right click for the browser's own) with formatting, block and table actions.
import type { Editor } from "@milkdown/kit/core";
import {
  createCodeBlockCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { addColAfterCommand, addColBeforeCommand, addRowAfterCommand, addRowBeforeCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import type { MarkType, Node as ProseNode } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, Selection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { CellSelection, deleteColumn, deleteRow, deleteTable, isInTable, selectedRect, TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, callCommand } from "@milkdown/kit/utils";
import { setStringAttr } from "../markdown/tera.ts";
import { defaultArgs, type ComponentInfo } from "../zola/components.ts";
import type { ContextItem, ContextSection, Overlay, ToolbarButton } from "./overlay.ts";
import type { ThemeInfo } from "./protocol.ts";

export interface MenuEnv {
  overlay: Overlay;
  components: Map<string, ComponentInfo>;
  theme: ThemeInfo;
  editor: () => Editor;
  openLink: (view: EditorView) => void;
  markDirty: () => void;
}

const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = mac ? "⌘" : "Ctrl+";

function hasMark(state: EditorState, type: MarkType | undefined): boolean {
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  return empty ? !!type.isInSet(state.storedMarks ?? $from.marks()) : state.doc.rangeHasMark(from, to, type);
}

/** The block a "Delete block" acts on: the innermost block directly in the page or in a component */
function currentBlock(state: EditorState): { pos: number; node: ProseNode } | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.isBlock) return { pos: selection.from, node: selection.node };
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const parent = $from.node(depth - 1);
    if (parent.type.name === "doc" || parent.type.name === "zola_block") return { pos: $from.before(depth), node: $from.node(depth) };
  }
  return null;
}

/** Set the alignment of every cell in the selection's column (GFM aligns whole columns) */
function alignColumn(view: EditorView, alignment: "left" | "center" | "right") {
  const rect = selectedRect(view.state);
  const map = TableMap.get(rect.table);
  let tr = view.state.tr;
  for (let row = 0; row < map.height; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const pos = rect.tableStart + map.map[row * map.width + col];
      const cell = tr.doc.nodeAt(pos);
      if (cell) tr = tr.setNodeMarkup(pos, undefined, { ...cell.attrs, alignment });
    }
  }
  view.dispatch(tr);
}

export function menus(env: MenuEnv) {
  const { overlay } = env;
  const run = (view: EditorView, command: Parameters<typeof callCommand>[0], payload?: unknown) => {
    env.markDirty();
    env.editor().action(callCommand(command, payload));
    view.focus();
  };

  const formatItems = (view: EditorView) => {
    const { schema } = view.state;
    return [
      { label: "Bold", icon: "bold" as const, keys: `${mod}B`, mark: schema.marks.strong, run: () => run(view, toggleStrongCommand.key) },
      { label: "Italic", icon: "italic" as const, keys: `${mod}I`, mark: schema.marks.emphasis, run: () => run(view, toggleEmphasisCommand.key) },
      { label: "Strikethrough", icon: "strikethrough" as const, keys: `${mod}${mac ? "⌥" : "Alt+"}X`, mark: schema.marks.strike_through, run: () => run(view, toggleStrikethroughCommand.key) },
      { label: "Inline code", icon: "code" as const, keys: `${mod}E`, mark: schema.marks.inlineCode, run: () => run(view, toggleInlineCodeCommand.key) },
      { label: "Link…", icon: "link" as const, keys: "", mark: schema.marks.link, run: () => env.openLink(view) },
    ];
  };

  const clearFormatting = (view: EditorView) => {
    const { from, to } = view.state.selection;
    env.markDirty();
    view.dispatch(view.state.tr.removeMark(from, to));
    view.focus();
  };

  /** Theme components that take text (e.g. mark, color): wrap the selected words in one */
  const wrapItems = (view: EditorView): ContextItem[] => {
    const { from, to, $from, $to } = view.state.selection;
    if (from === to || $from.parent !== $to.parent || !$from.parent.isTextblock) return [];
    const hidden = new Set(env.theme.hiddenComponents);
    return [...env.components.values()]
      .filter((component) => component.textParam && !component.block && !hidden.has(component.name))
      .map((component) => ({
        label: component.name,
        icon: "component",
        run: () => {
          const { schema } = view.state;
          const words = view.state.doc.textBetween(from, to);
          const args = setStringAttr(defaultArgs(component), "text", words);
          const node = schema.nodes.zola_text.create({ name: component.name, args, originalText: words }, schema.text(words));
          env.markDirty();
          view.dispatch(view.state.tr.replaceWith(from, to, node).scrollIntoView());
          view.focus();
        },
      }));
  };

  const turnIntoItems = (view: EditorView): ContextItem[] => {
    const { $from } = view.state.selection;
    if (!$from.parent.isTextblock || $from.parent.type.name === "code_block" || isInTable(view.state)) return [];
    return [
      { label: "Text", icon: "text", run: () => run(view, turnIntoTextCommand.key) },
      ...([1, 2, 3, 4] as const).map((level): ContextItem => ({ label: `Heading ${level}`, icon: `h${level}`, run: () => run(view, wrapInHeadingCommand.key, level) })),
      { label: "Quote", icon: "quote", run: () => run(view, wrapInBlockquoteCommand.key) },
      { label: "Bulleted list", icon: "list-unordered", run: () => run(view, wrapInBulletListCommand.key) },
      { label: "Numbered list", icon: "list-ordered", run: () => run(view, wrapInOrderedListCommand.key) },
      { label: "Code block", icon: "code-block", run: () => run(view, createCodeBlockCommand.key) },
    ];
  };

  const codeItems = (view: EditorView): ContextItem[] => {
    const { $from } = view.state.selection;
    if ($from.parent.type.name !== "code_block") return [];
    const pos = $from.before($from.depth);
    const node = $from.parent;
    return [
      {
        label: `Language: ${node.attrs.language || "none"}…`,
        icon: "tag",
        run: () => {
          const coords = view.coordsAtPos(pos + 1);
          overlay.openForm({
            anchor: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top),
            title: "Code language",
            note: "Used for highlighting, e.g. bash, toml, rust, js. Leave empty for none.",
            fields: [{ key: "language", label: "Language", value: String(node.attrs.language ?? "") }],
            actions: [
              {
                label: "Apply",
                run: (values) => {
                  env.markDirty();
                  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: String(values.language).trim() }));
                  view.focus();
                },
              },
            ],
          });
        },
      },
      { label: "Turn into text", icon: "text", run: () => run(view, turnIntoTextCommand.key) },
    ];
  };

  const tableSections = (view: EditorView): ContextSection[] => {
    if (!isInTable(view.state)) return [];
    const rect = selectedRect(view.state);
    // GFM tables always have exactly one header row, the first; it can't move or go away
    const inHeader = rect.top === 0;
    const onlyColumn = rect.map.width <= 1;
    const command = (fn: (state: EditorState, dispatch?: EditorView["dispatch"]) => boolean) => () => {
      env.markDirty();
      fn(view.state, view.dispatch);
      view.focus();
    };
    const align = (alignment: "left" | "center" | "right") => () => {
      env.markDirty();
      alignColumn(view, alignment);
      view.focus();
    };
    return [
      {
        title: inHeader ? "Row (the header row stays first)" : "Row",
        items: [
          { label: "Insert row above", icon: "arrow-up", disabled: inHeader, run: () => run(view, addRowBeforeCommand.key) },
          { label: "Insert row below", icon: "arrow-down", run: () => run(view, addRowAfterCommand.key) },
          { label: "Delete row", icon: "trash", disabled: inHeader, run: command(deleteRow) },
        ],
      },
      {
        title: "Column",
        items: [
          { label: "Insert column left", icon: "arrow-left", run: () => run(view, addColBeforeCommand.key) },
          { label: "Insert column right", icon: "arrow-right", run: () => run(view, addColAfterCommand.key) },
          { label: "Delete column", icon: "trash", run: command(onlyColumn ? deleteTable : deleteColumn) },
        ],
      },
      {
        title: "Align column",
        items: [
          { label: "Left", icon: "align-left", run: align("left") },
          { label: "Center", icon: "align-center", run: align("center") },
          { label: "Right", icon: "align-right", run: align("right") },
        ],
      },
      { title: "Table", items: [{ label: "Delete table", icon: "trash", run: command(deleteTable) }] },
    ];
  };

  const blockItems = (view: EditorView): ContextItem[] => {
    const block = currentBlock(view.state);
    if (!block) return [];
    const name = block.node.type.name === "zola_block" ? `{% ${block.node.attrs.name} %}` : block.node.type.name.replace(/_/g, " ");
    return [
      {
        label: `Select block (${name})`,
        icon: "gripper",
        run: () => {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos)));
          view.focus();
        },
      },
      {
        label: "Delete block",
        icon: "trash",
        run: () => {
          env.markDirty();
          view.dispatch(view.state.tr.delete(block.pos, block.pos + block.node.nodeSize).scrollIntoView());
          view.focus();
        },
      },
    ];
  };

  const showContext = (view: EditorView, x: number, y: number) => {
    const { selection } = view.state;
    const sections: ContextSection[] = [];
    if (!selection.empty && selection instanceof TextSelection) {
      sections.push({ title: "Format", items: [...formatItems(view), { label: "Clear formatting", icon: "eraser", run: () => clearFormatting(view) }] });
      const wrap = wrapItems(view);
      if (wrap.length) sections.push({ title: "Wrap in component", items: wrap });
    }
    const code = codeItems(view);
    if (code.length) sections.push({ title: "Code block", items: code });
    const table = tableSections(view);
    sections.push(...table);
    const turn = turnIntoItems(view);
    if (turn.length) sections.push({ title: "Turn into", items: turn });
    // In a table, "Delete table" is the block action
    const block = table.length ? [] : blockItems(view);
    if (block.length) sections.push({ title: "Block", items: block });
    if (sections.length) overlay.showContext(sections, x, y);
  };

  const updateToolbar = (view: EditorView) => {
    const { selection } = view.state;
    const show = !overlay.contextOpen && view.hasFocus() && !selection.empty && selection instanceof TextSelection && selection.$from.parent.type.name !== "code_block";
    if (!show) return overlay.hideToolbar();
    const buttons: ToolbarButton[] = formatItems(view).map((item) => ({
      icon: item.icon,
      title: `${item.label.replace("…", "")}${item.keys ? ` (${item.keys})` : ""}`,
      on: hasMark(view.state, item.mark),
      run: item.run,
    }));
    buttons.push({ icon: "eraser", title: "Clear formatting", separate: true, run: () => clearFormatting(view) });
    buttons.push({
      icon: "ellipsis",
      title: "More (also on right click)",
      run: () => {
        const end = view.coordsAtPos(view.state.selection.to);
        showContext(view, end.left, end.bottom + 8);
      },
    });
    const start = view.coordsAtPos(selection.from);
    const end = view.coordsAtPos(selection.to);
    overlay.showToolbar(buttons, { left: Math.min(start.left, end.left), right: Math.max(start.right, end.right), top: Math.min(start.top, end.top), bottom: end.bottom });
  };

  let selecting = false;
  return $prose(
    () =>
      new Plugin({
        // A cell selection of one cell hides the caret (prosemirror-tables): make it a cursor in that cell
        appendTransaction(_trs, _old, state) {
          const { selection } = state;
          if (!(selection instanceof CellSelection) || selection.$anchorCell.pos !== selection.$headCell.pos) return null;
          const cell = selection.$anchorCell.nodeAfter;
          if (!cell) return null;
          const end = selection.$anchorCell.pos + cell.nodeSize - 1;
          return state.tr.setSelection(Selection.findFrom(state.doc.resolve(end), -1, true) ?? Selection.near(state.doc.resolve(end)));
        },
        view: () => ({
          update: (view) => (selecting ? overlay.hideToolbar() : updateToolbar(view)),
          destroy: () => overlay.hideToolbar(),
        }),
        props: {
          handleDOMEvents: {
            contextmenu(view, event) {
              if (event.shiftKey) return false; // the browser's own menu
              event.preventDefault();
              // Like a browser: a right click outside the selection moves the cursor there
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
              const { from, to } = view.state.selection;
              if (at !== undefined && (at < from || at > to)) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(at))));
              overlay.hideToolbar();
              showContext(view, event.clientX, event.clientY);
              return true;
            },
            // The toolbar waits until the mouse selection is done
            mousedown(view, event) {
              if (event.button !== 0) return false;
              selecting = true;
              const done = () => {
                selecting = false;
                view.dom.ownerDocument.removeEventListener("mouseup", done, true);
                updateToolbar(view);
              };
              view.dom.ownerDocument.addEventListener("mouseup", done, true);
              return false;
            },
            blur() {
              // Not when focus goes to the toolbar itself (its buttons use mousedown and keep focus)
              setTimeout(() => {
                if (!selecting) overlay.hideToolbar();
              }, 100);
              return false;
            },
          },
        },
      }),
  );
}
