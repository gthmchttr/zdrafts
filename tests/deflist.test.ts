import type { Root } from "mdast";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { expect, test } from "vitest";
import { definitionListHandlers, remarkDefinitionList } from "../src/markdown/deflist.ts";

const processor = unified().use(remarkParse).use(remarkDefinitionList).use(remarkStringify, { handlers: definitionListHandlers });
const parse = (markdown: string) => processor.runSync(processor.parse(markdown)) as Root;
const shape = (node: unknown): unknown => {
  const n = node as { type: string; value?: string; children?: unknown[] };
  return n.children ? { [n.type]: n.children.map(shape) } : n.value ?? n.type;
};

test("terms and their definitions; adjacent groups make one list", () => {
  const tree = parse("Zola\n: A static site generator.\n\n[pulldown](https://x.org)\n: The *parser*.\n: Also fast.\n\nAfter.\n");
  expect(tree.children.map(shape)).toEqual([
    {
      definitionList: [
        { definitionTerm: ["Zola"] },
        { definitionDescription: ["A static site generator."] },
        { definitionTerm: [{ link: ["pulldown"] }] },
        { definitionDescription: ["The ", { emphasis: ["parser"] }, "."] },
        { definitionDescription: ["Also fast."] },
      ],
    },
    { paragraph: ["After."] },
  ]);
});

test("not definitions: no term, or a colon without a space", () => {
  expect(parse(": alone\n").children[0].type).toBe("paragraph");
  expect(parse("Term\n:no space\n").children[0].type).toBe("paragraph");
});

test("written back as they're written", () => {
  const source = "Zola\n: A static site generator.\n\npulldown\n: The parser.\n: Also fast.\n";
  expect(processor.stringify(parse(source))).toBe(source);
});
