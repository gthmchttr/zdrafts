import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, test } from "vitest";
import { splitFrontMatter } from "../src/markdown/frontmatter.ts";
import { preserveSource, splitBlocks } from "../src/markdown/preserve.ts";
import { remarkZola, zolaHandlers } from "../src/markdown/remark-zola.ts";
import { encodeTera } from "../src/markdown/tera.ts";

const fixtures = join(import.meta.dirname, "fixtures", "gthmchttr.com");

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...markdownFiles(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

const files = [
  ...markdownFiles(join(fixtures, "content")),
  ...markdownFiles(join(fixtures, "themes/zola-yolk/content")),
  ...markdownFiles(join(fixtures, "themes/zola-yolk/example_content")),
].map((path) => ({ name: relative(fixtures, path), body: splitFrontMatter(readFileSync(path, "utf8")).body }));

// Stands in for Milkdown's serializer, which normalizes the same way
const processor = unified()
  .use(remarkParse)
  .use(remarkStringify, { handlers: zolaHandlers, encode: [], bullet: "-", rule: "-" } as never)
  .use(remarkGfm)
  .use(remarkZola);
const serialize = (body: string) => processor.stringify(processor.runSync(processor.parse(encodeTera(body))) as Root);

/** Lines of `b` that aren't in `a` and the other way round, as a rough line diff */
function changedLines(a: string, b: string) {
  const left = a.split("\n");
  const right = b.split("\n");
  return { removed: left.filter((l) => !right.includes(l)), added: right.filter((l) => !left.includes(l)) };
}

describe("preserveSource", () => {
  test("unedited documents come back unchanged", () => {
    for (const { body } of files) expect(preserveSource(body, serialize(body), serialize(body))).toBe(body);
  });

  test.each(files.map((f) => [f.name, f.body] as const))("an edit to one block only changes that block: %s", (_name, body) => {
    const baseline = serialize(body);
    const blocks = splitBlocks(baseline)!;
    expect(blocks).not.toBeNull();
    expect(splitBlocks(body)!.length).toBe(blocks.length);
    // Append a word to the last paragraph-like block
    const target = [...blocks].reverse().find((b) => /^[A-Za-z]/.test(baseline.slice(b.start, b.end)));
    if (!target) return;
    const edited = baseline.slice(0, target.end) + " EDITED" + baseline.slice(target.end);
    const result = preserveSource(body, baseline, edited);
    const { removed, added } = changedLines(body, result);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/ EDITED$/);
    expect(removed.length).toBeLessThanOrEqual(1);
  });

  test("inserted and deleted blocks", () => {
    const body = "\nFirst  \nline\n\n| a | b |\n| --- | --- |\n| 1    | 2 |\n\nLast\n";
    const baseline = serialize(body);
    expect(preserveSource(body, baseline, baseline.replace("Last", "## New\n\nLast"))).toBe(
      "\nFirst  \nline\n\n| a | b |\n| --- | --- |\n| 1    | 2 |\n\n## New\n\nLast\n",
    );
    const withoutTable = baseline.replace(/\| a[\s\S]*?\n\n/, "");
    expect(preserveSource(body, baseline, withoutTable)).toBe("\nFirst  \nline\n\nLast\n");
  });

  test("components keep their source", () => {
    const body = '{% <warning title="x"> %}\nHi   there\n{% </warning> %}\n\n\nText {{ <color text="a" color="blue" /> }} here.\n';
    const baseline = serialize(body);
    const edited = baseline.replace("here.", "there.");
    expect(preserveSource(body, baseline, edited)).toBe('{% <warning title="x"> %}\nHi   there\n{% </warning> %}\n\n\nText {{ <color text="a" color="blue" /> }} there.\n');
  });
});
