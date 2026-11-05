// Definition lists, which Zola renders when a site sets `definition_list = true` under [markdown]
// (pulldown-cmark's extension):
//
//   Term
//   : Definition
//
// remark doesn't know them, so they come out of it as paragraphs: this turns a paragraph of term
// lines followed by `: ` lines into a definitionList node (adjacent ones into one list, as Zola
// does), and writes them back the same way.
import type { Nodes, Paragraph, Parent, PhrasingContent, Root } from "mdast";
import type { Handle } from "mdast-util-to-markdown";

export interface DefinitionList {
  type: "definitionList";
  children: (DefinitionTerm | DefinitionDescription)[];
}
export interface DefinitionTerm {
  type: "definitionTerm";
  children: PhrasingContent[];
}
export interface DefinitionDescription {
  type: "definitionDescription";
  children: PhrasingContent[];
}

/** A soft line break, as remark leaves it ("\n" in text) or as Milkdown makes it (an inline break) */
const isSoftBreak = (node: PhrasingContent) => node.type === "break" && (node.data as { isInline?: boolean } | undefined)?.isInline === true;

/** A paragraph's content split into its lines */
function lines(paragraph: Paragraph): PhrasingContent[][] {
  const out: PhrasingContent[][] = [[]];
  for (const node of paragraph.children) {
    if (isSoftBreak(node)) out.push([]);
    else if (node.type === "text" && node.value.includes("\n")) {
      node.value.split(/[ \t]*\n/).forEach((piece, i) => {
        if (i) out.push([]);
        if (piece) out.at(-1)!.push({ type: "text", value: piece });
      });
    } else out.at(-1)!.push(node);
  }
  return out;
}

const DEFINITION = /^ {0,3}:[ \t]+/;

/** A paragraph that is term lines, then definitions (lines starting with ": "): its terms and definitions */
function definitionGroup(paragraph: Paragraph): (DefinitionTerm | DefinitionDescription)[] | null {
  const all = lines(paragraph);
  const startsDefinition = (line: PhrasingContent[]) => line[0]?.type === "text" && DEFINITION.test(line[0].value);
  const first = all.findIndex(startsDefinition);
  if (first < 1 || all.slice(0, first).some((line) => !line.length)) return null;
  const out: (DefinitionTerm | DefinitionDescription)[] = all.slice(0, first).map((line) => ({ type: "definitionTerm", children: line }));
  for (const line of all.slice(first)) {
    if (startsDefinition(line)) {
      const [head, ...rest] = line as [{ type: "text"; value: string }, ...PhrasingContent[]];
      const text = head.value.replace(DEFINITION, "");
      out.push({ type: "definitionDescription", children: [...(text ? [{ type: "text" as const, value: text }] : []), ...rest] });
    } else {
      // A lazy continuation of the definition before it
      const last = out.at(-1)!;
      last.children.push({ type: "text", value: "\n" }, ...line);
    }
  }
  return out;
}

function transform(parent: Parent) {
  const children: Nodes[] = [];
  for (const child of parent.children as Nodes[]) {
    const group = child.type === "paragraph" ? definitionGroup(child) : null;
    const previous = children.at(-1);
    if (group && previous?.type === ("definitionList" as string)) (previous as unknown as DefinitionList).children.push(...group);
    else if (group) children.push({ type: "definitionList", children: group } as unknown as Nodes);
    else {
      if ("children" in child && child.type !== "paragraph") transform(child as Parent);
      children.push(child);
    }
  }
  parent.children = children as Parent["children"];
}

/** unified plugin: definition lists in the tree (after remark-parse and the other block plugins) */
export function remarkDefinitionList() {
  return (tree: Root) => transform(tree);
}

/** Writing them back: each group's terms, then its definitions; groups apart by a blank line */
export const definitionListHandlers: Record<string, Handle> = {
  definitionList(node, _, state, info) {
    const list = node as unknown as DefinitionList;
    const groups: string[] = [];
    let current = "";
    list.children.forEach((child, i) => {
      const text = state.containerPhrasing(child as never, info);
      if (child.type === "definitionTerm" && i > 0 && list.children[i - 1].type === "definitionDescription") {
        groups.push(current);
        current = "";
      }
      current += `${current ? "\n" : ""}${child.type === "definitionTerm" ? text : `: ${text}`}`;
    });
    groups.push(current);
    return groups.join("\n\n");
  },
};
