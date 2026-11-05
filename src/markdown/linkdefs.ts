// Link reference definitions ([docs]: https://… "title"): Zola renders nothing for them, but uses
// them for the references that name them ([Zola docs][docs]). Milkdown's remark-inline-links turns
// references into links and deletes the definitions, so a page with them can't be written back
// whole. This does the same for references, and keeps each definition as a linkDefinition node,
// written back as a definition.
import type { Definition, Root } from "mdast";
import { definitions } from "mdast-util-definitions";
import { SKIP, visit } from "unist-util-visit";

export interface LinkDefinition {
  type: "linkDefinition";
  identifier: string;
  label: string;
  url: string;
  title: string | null;
}

export function remarkLinkDefinitions() {
  return (tree: Root) => {
    const definition = definitions(tree);
    visit(tree, (node, index, parent) => {
      if (parent === undefined || typeof index !== "number") return;
      if (node.type === "definition") {
        const { identifier, label, url, title } = node as Definition;
        parent.children[index] = { type: "linkDefinition", identifier, label: label ?? identifier, url, title: title ?? null } as never;
        return SKIP;
      }
      if (node.type === "linkReference" || node.type === "imageReference") {
        const found = definition(node.identifier);
        if (!found) return;
        parent.children[index] =
          node.type === "imageReference" ? { type: "image", url: found.url, title: found.title, alt: node.alt } : { type: "link", url: found.url, title: found.title, children: node.children };
        return SKIP;
      }
    });
  };
}
