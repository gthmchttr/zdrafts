// The "/" command menu: type / at the start of a block (or after a space) and pick what to insert.
// `/head` lists Heading 1–6, `/border` the theme's border component, and so on.
import { setBlockType, wrapIn } from "@milkdown/kit/prose/commands";
import { wrapInList } from "@milkdown/kit/prose/schema-list";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { defaultArgs, isTemplateOnly, type ComponentInfo } from "../zola/components.ts";
import type { ThemeInfo } from "./protocol.ts";
import { currentBlock, makeCollapsible, makeColumns, setAlignment, setBox, type Block } from "./htmlcommands.ts";
import type { Overlay } from "./overlay.ts";

export interface SlashItem {
  id: string;
  group: string;
  label: string;
  description: string;
  icon: string;
  keywords: string[];
  run: (view: EditorView) => void;
}

export interface SlashActions {
  insertTable: () => void;
  insertImage: (view: EditorView) => void;
  insertLink: (view: EditorView) => void;
  /** Open a newly inserted component's settings */
  configure: (view: EditorView, pos: number) => void;
  markDirty: () => void;
}

const setBlock = (type: string, attrs?: Record<string, unknown>) => (view: EditorView) =>
  setBlockType(view.state.schema.nodes[type], attrs)(view.state, view.dispatch);

/** Replace the current (now empty) paragraph with `node`, or insert it after the current block */
function insertBlock(view: EditorView, make: (state: EditorState) => ReturnType<EditorState["schema"]["node"]>): number {
  const { state } = view;
  const { $from } = state.selection;
  const node = make(state);
  const empty = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
  const depth = $from.depth;
  let tr = state.tr;
  let pos: number;
  if (empty && depth >= 1) {
    pos = $from.before(depth);
    tr = tr.replaceWith(pos, $from.after(depth), node);
  } else {
    pos = $from.after(Math.max(1, depth));
    tr = tr.insert(pos, node);
  }
  // Put the cursor in the new block's first text position
  const inside = tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size));
  tr = tr.setSelection(TextSelection.near(inside));
  view.dispatch(tr.scrollIntoView());
  return pos;
}

export function slashItems(components: Map<string, ComponentInfo>, theme: ThemeInfo, actions: SlashActions): SlashItem[] {
  const items: SlashItem[] = [
    { id: "text", group: "Basic", label: "Text", description: "Plain paragraph", icon: "text", keywords: ["paragraph", "p"], run: setBlock("paragraph") },
    ...[1, 2, 3, 4, 5, 6].map((level) => ({
      id: `h${level}`,
      group: "Basic",
      label: `Heading ${level}`,
      description: `${"#".repeat(level)} Section heading`,
      icon: `h${level}`,
      keywords: ["heading", "head", "title", `h${level}`],
      run: setBlock("heading", { level }),
    })),
    {
      id: "bullet",
      group: "Basic",
      label: "Bulleted list",
      description: "- item",
      icon: "list-unordered",
      keywords: ["list", "ul", "unordered", "bullet"],
      run: (view) => wrapInList(view.state.schema.nodes.bullet_list)(view.state, view.dispatch),
    },
    {
      id: "ordered",
      group: "Basic",
      label: "Numbered list",
      description: "1. item",
      icon: "list-ordered",
      keywords: ["list", "ol", "ordered", "number"],
      run: (view) => wrapInList(view.state.schema.nodes.ordered_list)(view.state, view.dispatch),
    },
    {
      id: "task",
      group: "Basic",
      label: "Task list",
      description: "- [ ] to do",
      icon: "task",
      keywords: ["todo", "check", "checkbox", "task", "list"],
      run: (view) => {
        if (!wrapInList(view.state.schema.nodes.bullet_list)(view.state, view.dispatch)) return;
        const { $from } = view.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "list_item") {
            view.dispatch(view.state.tr.setNodeMarkup($from.before(d), undefined, { ...$from.node(d).attrs, checked: false }));
            break;
          }
        }
      },
    },
    {
      id: "quote",
      group: "Basic",
      label: "Quote",
      description: "> quoted text",
      icon: "quote",
      keywords: ["blockquote", "quote", "citation"],
      run: (view) => wrapIn(view.state.schema.nodes.blockquote)(view.state, view.dispatch),
    },
    { id: "code", group: "Basic", label: "Code block", description: "``` fenced code", icon: "code-block", keywords: ["code", "pre", "fence", "snippet"], run: setBlock("code_block") },
    { id: "table", group: "Basic", label: "Table", description: "3 × 3 table", icon: "table", keywords: ["table", "grid"], run: () => actions.insertTable() },
    {
      id: "hr",
      group: "Basic",
      label: "Divider",
      description: "--- horizontal rule",
      icon: "divider",
      keywords: ["hr", "divider", "rule", "line", "separator"],
      run: (view) => {
        const { state } = view;
        const { $from } = state.selection;
        const rule = state.schema.nodes.hr.create();
        const next = state.schema.nodes.paragraph.create();
        // An empty line becomes the rule; otherwise it goes after the current block
        const empty = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0;
        const start = empty ? $from.before($from.depth) : $from.after($from.depth);
        const tr = state.tr.replaceWith(start, empty ? $from.after($from.depth) : start, [rule, next]);
        view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(start + rule.nodeSize + 1))).scrollIntoView());
      },
    },
    { id: "image", group: "Basic", label: "Image", description: "![alt](path)", icon: "image", keywords: ["image", "picture", "img", "photo"], run: (view) => actions.insertImage(view) },
    { id: "link", group: "Basic", label: "Link", description: "[text](url)", icon: "link", keywords: ["link", "url", "href", "a"], run: (view) => actions.insertLink(view) },
  ];

  // Layout in plain HTML, so it works in any theme (src/frame/htmlcommands.ts)
  const onBlock = (change: (view: EditorView, block: Block) => void) => (view: EditorView) => {
    const block = currentBlock(view.state);
    if (!block) return;
    change(view, block);
    // The cursor goes back into the (now wrapped) line
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(Math.min(block.pos + 2, view.state.doc.content.size)))));
  };
  items.push(
    { id: "html:center", group: LAYOUT, label: "Centered", description: "Centre-aligned text", icon: "align-center", keywords: ["center", "centre", "align", "middle"], run: onBlock((view, block) => setAlignment(view, block, "center")) },
    { id: "html:right", group: LAYOUT, label: "Right-aligned", description: "Right-aligned text", icon: "align-right", keywords: ["right", "align"], run: onBlock((view, block) => setAlignment(view, block, "right")) },
    { id: "html:box", group: LAYOUT, label: "Box", description: "Bordered box", icon: "box-border", keywords: ["box", "border", "frame", "callout"], run: onBlock((view, block) => setBox(view, block, "border")) },
    { id: "html:shaded", group: LAYOUT, label: "Shaded box", description: "Box with a tinted background", icon: "box-shaded", keywords: ["box", "shaded", "background", "callout", "panel"], run: onBlock((view, block) => setBox(view, block, "shaded")) },
    { id: "html:columns2", group: LAYOUT, label: "2 columns", description: "Side by side; stacked on phones", icon: "columns-2", keywords: ["columns", "cols", "grid", "side"], run: (view) => { const block = currentBlock(view.state); if (block) makeColumns(view, block, 2); } },
    { id: "html:columns3", group: LAYOUT, label: "3 columns", description: "Side by side; stacked on phones", icon: "columns-3", keywords: ["columns", "cols", "grid", "side"], run: (view) => { const block = currentBlock(view.state); if (block) makeColumns(view, block, 3); } },
    { id: "html:details", group: LAYOUT, label: "Collapsible", description: "<details> with a title", icon: "collapsible", keywords: ["details", "collapse", "expand", "toggle", "accordion"], run: onBlock((view, block) => makeCollapsible(view, block)) },
  );

  const hidden = new Set(theme.hiddenComponents);
  // Theme components: blocks, then inline ones, each A to Z
  const sorted = [...components.values()].sort((a, b) => Number(!a.block) - Number(!b.block) || a.name.localeCompare(b.name));
  for (const component of sorted) {
    if (hidden.has(component.name) || isTemplateOnly(component)) continue;
    const hint = theme.componentHints[component.name] ?? {};
    const args = defaultArgs(component);
    const base = {
      id: `component:${component.name}`,
      label: hint.label ?? component.name,
      icon: component.block ? "component" : "inline-component",
      keywords: [component.name, ...(hint.keywords ?? []), "component", "shortcode"],
    };
    if (component.block) {
      items.push({
        ...base,
        group: THEME_BLOCKS,
        description: hint.description ?? `{% <${component.name}> %}`,
        run: (view) => {
          const { schema } = view.state;
          const pos = insertBlock(view, () => schema.nodes.zola_block.create({ name: component.name, args }, schema.nodes.paragraph.create()));
          if (args) actions.configure(view, pos);
        },
      });
    } else if (component.textParam) {
      items.push({
        ...base,
        group: THEME_INLINE,
        description: hint.description ?? `{{ <${component.name} /> }}`,
        run: (view) => {
          const { schema } = view.state;
          const words = component.name;
          const node = schema.nodes.zola_text.create({ name: component.name, args: `${args} text="${words}"`, originalText: words }, schema.text(words));
          const from = view.state.selection.from;
          const tr = view.state.tr.replaceSelectionWith(node, false);
          // Select the placeholder text so typing replaces it
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1, from + 1 + words.length)));
        },
      });
    } else {
      items.push({
        ...base,
        group: THEME_INLINE,
        description: hint.description ?? `{{ <${component.name} /> }}`,
        run: (view) => {
          const { schema } = view.state;
          const from = view.state.selection.from;
          view.dispatch(view.state.tr.replaceSelectionWith(schema.nodes.zola_atom.create({ name: component.name, args })));
          actions.configure(view, from);
        },
      });
    }
  }
  return items;
}

const LAYOUT = "Layout (HTML, any theme)";
const THEME_BLOCKS = "Theme blocks";
const THEME_INLINE = "Theme inline";
const GROUP_ORDER = ["Basic", LAYOUT, THEME_BLOCKS, THEME_INLINE];
const groupRank = (item: SlashItem) => GROUP_ORDER.indexOf(item.group);

/** Items matching what was typed after the slash, best matches first */
export function filterItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase();
  if (!q) return items;
  const score = (item: SlashItem) => {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) return 0;
    if (item.keywords.some((k) => k.toLowerCase().startsWith(q))) return 1;
    if (label.includes(q)) return 2;
    if (item.keywords.some((k) => k.toLowerCase().includes(q))) return 3;
    return -1;
  };
  return items
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score >= 0)
    // Groups stay together (in their usual order), best matches first within each
    .sort((a, b) => groupRank(a.item) - groupRank(b.item) || a.score - b.score || a.index - b.index)
    .map((entry) => entry.item);
}

const TRIGGER = /(?:^|\s)\/([\w.-]{0,30})$/;

export function slashPlugin(getItems: () => SlashItem[], overlay: Overlay, markDirty: () => void) {
  const key = new PluginKey("zdrafts-slash");
  const state = { open: false, from: 0, to: 0, query: "", active: 0, matches: [] as SlashItem[], dismissed: -1 };

  const close = () => {
    state.open = false;
    overlay.hideMenu();
  };

  const choose = (view: EditorView, index: number) => {
    const item = state.matches[index];
    if (!item) return;
    close();
    markDirty();
    view.dispatch(view.state.tr.delete(state.from, state.to));
    item.run(view);
    view.focus();
  };

  return $prose(
    () =>
      new Plugin({
        key,
        view: () => ({
          update(view) {
            const { selection } = view.state;
            const { $from } = selection;
            const textblock = $from.parent;
            if (!selection.empty || !textblock.isTextblock || textblock.type.name === "code_block") return close();
            const before = textblock.textBetween(0, $from.parentOffset, "\n", "￼");
            const match = TRIGGER.exec(before);
            if (!match) {
              state.dismissed = -1;
              return close();
            }
            const from = $from.pos - match[1].length - 1;
            if (from === state.dismissed) return close();
            if (!state.open || state.from !== from || state.query !== match[1]) state.active = 0;
            Object.assign(state, { open: true, from, to: $from.pos, query: match[1] });
            state.matches = filterItems(getItems(), match[1]);
            state.active = Math.min(state.active, Math.max(0, state.matches.length - 1));
            const coords = view.coordsAtPos(from);
            overlay.showMenu(
              state.matches.map(({ group, label, description, icon }) => ({ group, label, description, icon })),
              state.active,
              coords,
              (index) => choose(view, index),
            );
          },
          destroy: close,
        }),
        props: {
          handleKeyDown(view, event) {
            if (!state.open) return false;
            const count = state.matches.length;
            switch (event.key) {
              case "ArrowDown":
                state.active = count ? (state.active + 1) % count : 0;
                break;
              case "ArrowUp":
                state.active = count ? (state.active - 1 + count) % count : 0;
                break;
              case "Enter":
              case "Tab":
                if (!count) return false;
                choose(view, state.active);
                return true;
              case "Escape":
                state.dismissed = state.from;
                close();
                return true;
              default:
                return false;
            }
            overlay.showMenu(
              state.matches.map(({ group, label, description, icon }) => ({ group, label, description, icon })),
              state.active,
              view.coordsAtPos(state.from),
              (index) => choose(view, index),
            );
            return true;
          },
        },
      }),
  );
}
