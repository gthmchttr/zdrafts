import type { Root } from "mdast";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { expect, test } from "vitest";
import { remarkLinkDefinitions } from "../src/markdown/linkdefs.ts";

test("references become links; definitions stay, and are written back", () => {
  const processor = unified().use(remarkParse).use(remarkLinkDefinitions).use(remarkStringify);
  const tree = processor.runSync(processor.parse('Read the [Zola docs][docs].\n\n[docs]: https://www.getzola.org "Official"\n')) as Root;
  expect(tree.children.map((node) => node.type)).toEqual(["paragraph", "linkDefinition"]);
  const link = (tree.children[0] as { children: { type: string; url?: string }[] }).children[1];
  expect(link).toMatchObject({ type: "link", url: "https://www.getzola.org" });
  // The editor writes a definition back for the linkDefinition (src/frame/linkdefs.ts)
  const definition = tree.children[1] as unknown as { identifier: string; label: string; url: string; title: string };
  tree.children[1] = { type: "definition", identifier: definition.identifier, label: definition.label, url: definition.url, title: definition.title };
  expect(processor.stringify(tree)).toContain('[docs]: https://www.getzola.org "Official"');
});

test("bare URLs stay text, as in Zola; written links stay links", async () => {
  const { remarkNoLiteralLinks } = await import("../src/markdown/literal-links.ts");
  const remarkGfm = (await import("remark-gfm")).default;
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkNoLiteralLinks);
  const source = "See https://example.com and www.zola.org, <https://a.org> and [b](https://b.org).";
  const tree = processor.runSync(processor.parse(source), source) as Root;
  const kinds = (tree.children[0] as { children: { type: string; value?: string }[] }).children.map((node) => (node.type === "text" ? node.value : node.type));
  expect(kinds).toEqual(["See ", "https://example.com", " and ", "www.zola.org", ", ", "link", " and ", "link", "."]);
});
