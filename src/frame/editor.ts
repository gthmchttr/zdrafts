// The Milkdown editor that replaces a page's content inside the site's own markup.
import { defaultValueCtx, Editor, editorViewCtx, parserCtx, remarkStringifyOptionsCtx, rootCtx, serializerCtx } from "@milkdown/kit/core";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand, remarkGFMPlugin } from "@milkdown/kit/preset/gfm";
import { callCommand } from "@milkdown/kit/utils";
import { preserveSource } from "../markdown/preserve.ts";
import { zolaHandlers } from "../markdown/remark-zola.ts";
import { encodeTera } from "../markdown/tera.ts";
import type { ComponentInfo } from "../zola/components.ts";
import { COMPONENT_ATTR, inlineTextKeys, probeRefresh, probeRefreshKey, remarkZolaPlugin, zolaNodes, zolaViews, type EditorEnv } from "./nodes.ts";
import { Overlay } from "./overlay.ts";
import { Probes } from "./probes.ts";
import type { FrameToShell, ShellToFrame } from "./protocol.ts";
import { openComponentSettings, openImageForm, openLinkForm, type SettingsEnv } from "./settings.ts";
import { slashItems, slashPlugin, type SlashItem } from "./slash.ts";

type DocMessage = Extract<ShellToFrame, { type: "doc" }>;

export async function createEditor(root: HTMLElement, message: DocMessage, post: (message: FrameToShell) => void, probes: Probes) {
  const doc = root.ownerDocument;
  const components = new Map<string, ComponentInfo>(message.components.map((c) => [c.name, c]));
  const overlay = new Overlay(doc);

  // Only real edits make a draft: loading a page and rendering its components must not
  let dirty = false;
  // The unedited page as Milkdown writes it, so unchanged blocks can keep their original text
  let baseline: string | null = null;
  const markDirty = () => (dirty = true);
  for (const event of ["beforeinput", "paste", "drop", "cut"]) root.addEventListener(event, markDirty, true);
  root.addEventListener("keydown", (event) => {
    if (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === "Enter") markDirty();
  });

  const settingsEnv: SettingsEnv = { overlay, components, probes, staticImages: message.staticImages, markDirty };
  const env: EditorEnv = {
    doc,
    probes,
    components,
    siteUrl: message.siteUrl,
    openSettings: (element) => openComponentSettings(settingsEnv, element),
  };
  const nodes = zolaNodes(env);

  let editor: Editor;
  let items: SlashItem[] = [];
  items = slashItems(components, message.theme, {
    insertTable: () => editor.action(callCommand(insertTableCommand.key, { row: 3, col: 3 })),
    insertImage: (view) => openImageForm(settingsEnv, view),
    insertLink: (view) => openLinkForm(settingsEnv, view),
    configure: (view, pos) =>
      requestAnimationFrame(() => {
        const dom = view.nodeDOM(pos);
        const element = dom instanceof HTMLElement ? (dom.closest(`[${COMPONENT_ATTR}]`) as HTMLElement | null) ?? dom : null;
        if (element) env.openSettings(element);
      }),
    markDirty,
  });

  editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      // Tera syntax is swapped for placeholders before Markdown parsing (src/markdown/tera.ts)
      ctx.set(defaultValueCtx, encodeTera(message.body));
      ctx.update(remarkStringifyOptionsCtx, (options) => ({
        ...options,
        handlers: { ...options.handlers, ...zolaHandlers },
        // Closest to how Zola sites are usually written
        bullet: "-" as const,
        rule: "-" as const,
        resourceLink: true,
        fences: true,
      }));
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
        if (dirty && baseline !== null) post({ type: "doc-change", path: message.path, body: preserveSource(message.body, baseline, markdown) });
      });
    })
    .use(commonmark)
    .use(gfm)
    .config((ctx) => ctx.set(remarkGFMPlugin.options.key, { tablePipeAlign: false }))
    .use(history)
    .use(listener)
    .use(clipboard)
    .use(remarkZolaPlugin)
    .use([nodes.block, nodes.text, nodes.atom, nodes.teraBlock])
    .use(zolaViews(env, nodes))
    .use(probeRefresh(nodes))
    .use(inlineTextKeys)
    .use(slashPlugin(() => items, overlay, markDirty));

  await editor.create();

  editor.action((ctx) => {
    // Pasted Markdown goes through the same Tera handling as the page itself
    ctx.update(parserCtx, (parse) => ((markdown: string) => parse(encodeTera(markdown))) as typeof parse);
    const view = ctx.get(editorViewCtx);
    baseline = ctx.get(serializerCtx)(view.state.doc);
    probes.onChange(() => view.dispatch(view.state.tr.setMeta(probeRefreshKey, probes.version)));
  });

  // A small handle on the component under the pointer opens its settings
  let hovered: HTMLElement | null = null;
  doc.addEventListener("mousemove", (event) => {
    const target = event.target as Element;
    if (overlay.isHandle(event.composedPath()[0] ?? null)) return;
    const element = root.contains(target) ? (target.closest(`[${COMPONENT_ATTR}]`) as HTMLElement | null) : null;
    if (element === hovered) return;
    hovered = element;
    if (element && element.getAttribute(COMPONENT_ATTR) !== "tera") {
      overlay.showHandle(element, element.getAttribute(COMPONENT_ATTR)!, () => env.openSettings(element));
    } else if (!element) overlay.hideHandle();
  });
  doc.addEventListener("scroll", () => overlay.hideHandle(), true);

  return editor;
}
