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
