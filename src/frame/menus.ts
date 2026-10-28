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
import type { MarkType } from "@milkdown/kit/prose/model";
import { NodeSelection, Plugin, Selection, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import { CellSelection, deleteColumn, deleteRow, deleteTable, isInTable, selectedRect, TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, callCommand } from "@milkdown/kit/utils";
import { setStringAttr } from "../markdown/tera.ts";
import { defaultArgs, isTemplateOnly, type ComponentInfo } from "../zola/components.ts";
import {
  addColumn,
  ALIGNMENTS,
  blockStyle,
  BOXES,
  boxKind,
  columnsOf,
  currentBlock,
  detailsOf,
  hasTag,
  HIGHLIGHTS,
  makeCollapsible,
  makeColumns,
  removeColumn,
  removeColumns,
  setAlignment,
  setBox,
  setCollapsibleTitle,
  setHighlight,
  setTextColor,
  TEXT_COLORS,
  TEXT_TAGS,
  toggleTag,
  unwrap,
  type Alignment,
  type Block,
  type BoxKind,
} from "./htmlcommands.ts";
import { summaryText } from "./htmlnodes.ts";
import type { ContextItem, ContextSection, Overlay, RowButton, ToolbarButton } from "./overlay.ts";
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
      .filter((component) => component.textParam && !component.block && !hidden.has(component.name) && !isTemplateOnly(component))
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

  /** Run an edit, then give the editor back its focus */
  const edit = (view: EditorView, change: () => void) => () => {
    env.markDirty();
    change();
    view.focus();
  };

  const tagItems = (view: EditorView): ContextItem[] =>
    TEXT_TAGS.map(({ tag, label, icon }) => ({ label: `${label}${hasTag(view.state, tag) ? " ✓" : ""}`, icon, run: edit(view, () => toggleTag(view, tag)) }));

  const colorRow = (view: EditorView): RowButton[] => [
    ...TEXT_COLORS.map(({ name, value }): RowButton => ({ title: `${name} text`, swatch: { color: value, kind: "text" }, run: edit(view, () => setTextColor(view, value)) })),
    { title: "Default text colour", swatch: { color: "", kind: "none" }, run: edit(view, () => setTextColor(view, null)) },
  ];

  const highlightRow = (view: EditorView): RowButton[] => [
    ...HIGHLIGHTS.map(({ name, value }): RowButton => ({ title: `${name} highlight`, swatch: { color: value, kind: "fill" }, run: edit(view, () => setHighlight(view, value)) })),
    { title: "No highlight", swatch: { color: "", kind: "none" }, run: edit(view, () => setHighlight(view, null)) },
  ];

  /** Layout of the block (any theme): alignment, box, columns, collapsible */
  const layoutSections = (view: EditorView, block: Block): ContextSection[] => {
    const align = (blockStyle(view.state, block, "text-align") ?? "left") as Alignment;
    const box = boxKind(view.state, block);
    const columns = columnsOf(view.state, block);
    const details = detailsOf(view.state, block);
    const sections: ContextSection[] = [
      {
        title: "Align",
        row: ALIGNMENTS.map((value) => ({ title: `Align ${value}`, icon: `align-${value}` as const, on: align === value, run: edit(view, () => setAlignment(view, block, value)) })),
      },
      {
        title: "Box",
        row: [
          ...(Object.keys(BOXES) as BoxKind[]).map((kind) => ({ title: BOXES[kind].label, icon: BOXES[kind].icon, on: box === kind, run: edit(view, () => setBox(view, block, kind)) })),
          { title: "No box", icon: "unwrap" as const, run: edit(view, () => setBox(view, block, null)) },
        ],
      },
    ];
    sections.push(
      columns
        ? {
            title: "Columns",
            items: [
              { label: "Add a column", icon: "column-add", run: edit(view, () => addColumn(view, block)) },
              { label: "Remove this column", icon: "trash", run: edit(view, () => removeColumn(view, block)) },
              { label: "Back to one column", icon: "unwrap", run: edit(view, () => removeColumns(view, block)) },
            ],
          }
        : {
            title: "Columns",
            row: [
              { title: "2 columns", icon: "columns-2", run: edit(view, () => makeColumns(view, block, 2)) },
              { title: "3 columns", icon: "columns-3", run: edit(view, () => makeColumns(view, block, 3)) },
            ],
          },
    );
    sections.push({
      title: "Collapsible",
      items: details
        ? [
            { label: `Title: ${summaryText(details.node.attrs.summary) || "Details"}…`, icon: "collapsible", run: () => editTitle(view, details) },
            { label: "Not collapsible", icon: "unwrap", run: edit(view, () => unwrap(view, details)) },
          ]
        : [{ label: "Make collapsible", icon: "collapsible", run: edit(view, () => makeCollapsible(view, block)) }],
    });
    return sections;
  };

  const editTitle = (view: EditorView, details: Block) => {
    const dom = view.nodeDOM(details.pos) as HTMLElement | null;
    const rect = dom?.getBoundingClientRect() ?? new DOMRect(40, 40, 0, 0);
    overlay.openForm({
      anchor: new DOMRect(rect.left, rect.top, 0, 24),
      title: "Collapsible title",
      fields: [{ key: "title", label: "Title", value: summaryText(details.node.attrs.summary) || "Details" }],
      actions: [{ label: "Apply", run: (values) => edit(view, () => setCollapsibleTitle(view, details, String(values.title).trim() || "Details"))() }],
    });
  };

  const showContext = (view: EditorView, x: number, y: number) => {
    const { selection } = view.state;
    const sections: ContextSection[] = [];
    if (!selection.empty && selection instanceof TextSelection) {
      sections.push({ title: "Format", items: [...formatItems(view), ...tagItems(view), { label: "Clear formatting", icon: "eraser", run: () => clearFormatting(view) }] });
      sections.push({ title: "Text colour", row: colorRow(view) }, { title: "Highlight", row: highlightRow(view) });
      const wrap = wrapItems(view);
      if (wrap.length) sections.push({ title: "Wrap in component", items: wrap });
    }
    const code = codeItems(view);
    if (code.length) sections.push({ title: "Code block", items: code });
    const table = tableSections(view);
    sections.push(...table);
    const turn = turnIntoItems(view);
    if (turn.length) sections.push({ title: "Turn into", items: turn });
    const current = currentBlock(view.state);
    if (current) sections.push(...layoutSections(view, current));
    // In a table, "Delete table" is the block action
    const block = table.length ? [] : blockItems(view);
    if (block.length) sections.push({ title: "Block", items: block });
    if (sections.length) overlay.showContext(sections, x, y);
  };

  /** Formatting toolbar over selected text */
  const textToolbar = (view: EditorView) => {
    const { selection } = view.state;
    const buttons: ToolbarButton[] = formatItems(view).map((item) => ({
      icon: item.icon,
      title: `${item.label.replace("…", "")}${item.keys ? ` (${item.keys})` : ""}`,
      on: hasMark(view.state, item.mark),
      run: item.run,
    }));
    buttons.push({ icon: "underline", title: "Underline", on: hasTag(view.state, "u"), run: edit(view, () => toggleTag(view, "u")) });
    buttons.push({
      icon: "text-color",
      title: "Text colour and highlight",
      separate: true,
      run: () => {
        const end = view.coordsAtPos(view.state.selection.to);
        overlay.showContext([{ title: "Text colour", row: colorRow(view) }, { title: "Highlight", row: highlightRow(view) }], end.left, end.bottom + 8);
      },
    });
    buttons.push({ icon: "eraser", title: "Clear formatting", run: () => clearFormatting(view) });
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

  /** Layout toolbar over a selected block (selected with its grip) */
  const blockToolbar = (view: EditorView, block: Block) => {
    // After a change the block (or its new wrapper) stays selected, for the next change
    const keep = (change: () => void) => () => {
      env.markDirty();
      change();
      const node = view.state.doc.nodeAt(block.pos);
      if (node?.isBlock) view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, block.pos)));
      view.focus();
    };
    const dom = view.nodeDOM(block.pos);
    if (!(dom instanceof HTMLElement)) return overlay.hideToolbar();
    const align = (blockStyle(view.state, block, "text-align") ?? "left") as Alignment;
    const box = boxKind(view.state, block);
    const buttons: ToolbarButton[] = [
      ...ALIGNMENTS.map((value) => ({ icon: `align-${value}` as const, title: `Align ${value}`, on: align === value, run: keep(() => setAlignment(view, block, value)) })),
      ...(Object.keys(BOXES) as BoxKind[]).map((kind, i) => ({
        icon: BOXES[kind].icon,
        title: box === kind ? `${BOXES[kind].label} (click to remove)` : BOXES[kind].label,
        on: box === kind,
        separate: i === 0,
        run: keep(() => setBox(view, block, box === kind ? null : kind)),
      })),
    ];
    if (!columnsOf(view.state, block)) buttons.push({ icon: "columns-2", title: "2 columns", separate: true, run: edit(view, () => makeColumns(view, block, 2)) });
    if (!detailsOf(view.state, block)) buttons.push({ icon: "collapsible", title: "Make collapsible", run: edit(view, () => makeCollapsible(view, block)) });
    buttons.push({
      icon: "ellipsis",
      title: "More (also on right click)",
      separate: true,
      run: () => {
        const rect = dom.getBoundingClientRect();
        showContext(view, rect.left, rect.top + 8);
      },
    });
    const rect = dom.getBoundingClientRect();
    overlay.showToolbar(buttons, { left: rect.left, right: rect.left + Math.min(rect.width, 320), top: rect.top, bottom: rect.top + 24 });
  };

  const updateToolbar = (view: EditorView) => {
    const { selection } = view.state;
    if (overlay.contextOpen || !view.hasFocus()) return overlay.hideToolbar();
    if (selection instanceof NodeSelection && selection.node.isBlock) return blockToolbar(view, { pos: selection.from, node: selection.node });
    if (!selection.empty && selection instanceof TextSelection && selection.$from.parent.type.name !== "code_block") return textToolbar(view);
    overlay.hideToolbar();
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
          // Next frame: the grip selects a block before it focuses the editor
          update: (view) => (selecting ? overlay.hideToolbar() : requestAnimationFrame(() => updateToolbar(view))),
          destroy: () => overlay.hideToolbar(),
        }),
        props: {
          // A paragraph or heading selected as a block (with its grip): typing goes on at its end
          // instead of replacing it. Delete and Backspace still remove the block.
          handleTextInput(view, _from, _to, text) {
            const { selection } = view.state;
            if (!(selection instanceof NodeSelection) || !selection.node.isTextblock) return false;
            const end = selection.from + selection.node.nodeSize - 1;
            // Plain text: not part of a link or other mark the block happens to end with
            const tr = view.state.tr.insert(end, view.state.schema.text(text));
            view.dispatch(tr.setSelection(TextSelection.create(tr.doc, end + text.length)).setStoredMarks([]).scrollIntoView());
            return true;
          },
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
            focus(view) {
              requestAnimationFrame(() => updateToolbar(view));
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
