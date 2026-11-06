// Bare URLs (https://example.com, www.example.com) aren't links in Zola: pulldown-cmark only links
// <https://…> and [text](…). remark-gfm (which Milkdown uses for tables, task lists…) makes links of
// them too: this turns those back into the text they were.
import type { Root } from "mdast";
import { SKIP, visit } from "unist-util-visit";

export function remarkNoLiteralLinks() {
  return (tree: Root, file: { value?: unknown }) => {
    const source = typeof file.value === "string" ? file.value : null;
    if (source === null) return;
    visit(tree, "link", (node, index, parent) => {
      const start = node.position?.start.offset;
      if (parent === undefined || typeof index !== "number" || start === undefined) return;
      // Written as a link: [text](…) or <…>
      if (source[start] === "[" || source[start] === "<") return;
      parent.children[index] = { type: "text", value: source.slice(start, node.position!.end.offset) };
      return SKIP;
    });
  };
}
