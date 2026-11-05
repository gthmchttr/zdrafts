// Link reference definitions in the editor (src/markdown/linkdefs.ts): shown only to edit, as
// Zola renders nothing for them.
import { remarkInlineLinkPlugin } from "@milkdown/kit/preset/commonmark";
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import { remarkLinkDefinitions } from "../markdown/linkdefs.ts";

/** In place of Milkdown's remarkInlineLinkPlugin (filter that one out of commonmark) */
export const replacedPlugin = remarkInlineLinkPlugin;
export const remarkLinkDefinitionsPlugin = $remark("remarkLinkDefinitions", () => remarkLinkDefinitions);

export const linkDefinitionSchema = $nodeSchema("link_definition", () => ({
  group: "block",
  atom: true,
  selectable: true,
  attrs: { identifier: { default: "" }, label: { default: "" }, url: { default: "" }, title: { default: null } },
  parseDOM: [],
  toDOM: (node) => [
    "div",
    { class: "zd-editing zd-link-definition", contenteditable: "false" },
    `[${node.attrs.label}]: ${node.attrs.url}${node.attrs.title ? ` "${node.attrs.title}"` : ""}`,
  ],
  parseMarkdown: {
    match: (node) => node.type === "linkDefinition",
    runner: (state, node, type) => {
      const { identifier, label, url, title } = node as unknown as { identifier: string; label: string; url: string; title: string | null };
      state.addNode(type, { identifier, label, url, title });
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "link_definition",
    runner: (state, node) => {
      const { identifier, label, url, title } = node.attrs;
      state.addNode("definition", undefined, undefined, { identifier, label, url, title });
    },
  },
}));
