// Definition lists in the editor (src/markdown/deflist.ts): <dl> of <dt> terms and <dd> definitions.
import { $nodeSchema, $remark } from "@milkdown/kit/utils";
import { remarkDefinitionList } from "../markdown/deflist.ts";

export const remarkDefinitionListPlugin = $remark("remarkDefinitionList", () => remarkDefinitionList);

const part = (name: string, tag: string, mdast: string) =>
  $nodeSchema(name, () => ({
    content: "inline*",
    defining: true,
    parseDOM: [{ tag }],
    toDOM: () => [tag, 0],
    parseMarkdown: {
      match: (node) => node.type === mdast,
      runner: (state, node, type) => {
        state.openNode(type);
        state.next(node.children);
        state.closeNode();
      },
    },
    toMarkdown: {
      match: (node) => node.type.name === name,
      runner: (state, node) => {
        state.openNode(mdast);
        state.next(node.content);
        state.closeNode();
      },
    },
  }));

export const definitionListSchema = $nodeSchema("definition_list", () => ({
  group: "block",
  content: "(definition_term | definition_description)+",
  // Below footnote definitions, which Milkdown also draws as <dl>
  parseDOM: [{ tag: "dl", priority: 40 }],
  toDOM: () => ["dl", 0],
  parseMarkdown: {
    match: (node) => node.type === "definitionList",
    runner: (state, node, type) => {
      state.openNode(type);
      state.next(node.children);
      state.closeNode();
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === "definition_list",
    runner: (state, node) => {
      state.openNode("definitionList");
      state.next(node.content);
      state.closeNode();
    },
  },
}));

export const definitionLists = [definitionListSchema, part("definition_term", "dt", "definitionTerm"), part("definition_description", "dd", "definitionDescription")].flat();
