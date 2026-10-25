import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, test } from "vitest";
import { joinFrontMatter, splitFrontMatter } from "../src/markdown/frontmatter.ts";
import { remarkZola, zolaHandlers } from "../src/markdown/remark-zola.ts";
import { decodePlaceholder, decodeTera, encodeTera, parseAttrs, PLACEHOLDER, setStringAttr } from "../src/markdown/tera.ts";

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
].map((path) => ({ name: relative(fixtures, path), text: readFileSync(path, "utf8") }));

// The same pipeline as Milkdown: remark-parse + remark-stringify, then plugins
const processor = unified()
  .use(remarkParse)
  .use(remarkStringify, { handlers: zolaHandlers, encode: [] } as never)
  .use(remarkGfm)
  .use(remarkZola);

const parse = (body: string) => processor.runSync(processor.parse(encodeTera(body))) as Root;
const stringify = (tree: Root) => processor.stringify(tree);

function collect(node: Nodes | Root, types: string[], out: string[] = []): string[] {
  if (types.includes(node.type)) {
    const record = node as unknown as { name?: string; raw?: string };
    out.push(`${node.type}:${record.name ?? record.raw}`);
  }
  if ("children" in node) for (const child of node.children) collect(child as Nodes, types, out);
  return out;
}

const COMPONENT_TYPES = ["zolaBlock", "zolaInline", "zolaTera", "zolaTeraBlock"];

function countTokens(body: string): number {
  let count = 0;
  for (const [, encoded] of encodeTera(body).matchAll(PLACEHOLDER)) {
    const token = decodePlaceholder(encoded);
    count += 1 + (token.type === "block" ? countTokens(token.body) : 0);
  }
  return count;
}

test("fixtures are present (npm run fixtures)", () => {
  expect(files.length).toBeGreaterThan(10);
});

describe("front matter", () => {
  test.each([
    ["+++\ntitle = \"a\"\n+++\nbody\n", "toml", "body\n"],
    ["---\ntitle: a\n---\nbody", "yaml", "body"],
    ["---\ntitle: \"posts\"\n---", "yaml", ""],
    ["no front matter\n", null, "no front matter\n"],
  ])("%j", (text, format, body) => {
    const split = splitFrontMatter(text);
    expect(split.format).toBe(format);
    expect(split.body).toBe(body);
    expect(joinFrontMatter(split.frontMatter, split.body)).toBe(text);
  });

  test.each(files)("splits and rejoins $name", ({ text }) => {
    const { frontMatter, body } = splitFrontMatter(text);
    expect(joinFrontMatter(frontMatter, body)).toBe(text);
  });
});

describe("tera placeholders", () => {
  test.each(files)("encoding $name is lossless", ({ text }) => {
    const { body } = splitFrontMatter(text);
    expect(decodeTera(encodeTera(body))).toBe(body);
  });

  test("skips code", () => {
    const body = "`{{ <x /> }}` and\n\n```\n{% <y> %}\n{% </y> %}\n```\n\n{{ <z /> }}\n";
    const tree = parse(body);
    expect(collect(tree, COMPONENT_TYPES)).toEqual(["zolaInline:z"]);
  });

  test("nested blocks and inline components", () => {
    const body = '{% <border> %}\n{% <warning title="T"> %}\nHi {{ <color text="x" color="blue" /> }}!\n{% </warning> %}\n{% </border> %}\n';
    const tree = parse(body);
    expect(collect(tree, COMPONENT_TYPES)).toEqual(["zolaBlock:border", "zolaBlock:warning", "zolaInline:color"]);
    expect(stringify(tree)).toBe(
      '{% <border> %}\n{% <warning title="T"> %}\nHi {{ <color text="x" color="blue" /> }}!\n{% </warning> %}\n{% </border> %}\n',
    );
  });
});

describe("round trip", () => {
  test.each(files)("$name keeps its components and is stable", ({ text }) => {
    const { body } = splitFrontMatter(text);
    const tree = parse(body);
    const components = collect(tree, COMPONENT_TYPES);
    // Every piece of Tera in the source, nested ones included, becomes exactly one node
    expect(components.length).toBe(countTokens(body));
    const once = stringify(tree);
    const twice = stringify(parse(once));
    expect(twice).toBe(once);
    expect(collect(parse(once), COMPONENT_TYPES)).toEqual(components);
    // Placeholders never leak into the output
    expect(once).not.toMatch(/[]/);
  });
});

describe("component arguments", () => {
  test("parses every kind of argument", () => {
    const attrs = parseAttrs(` title="Dis \\"claimer\\"" open={true} titles={["a", "b"]} name {...rest} n=3`);
    expect(attrs.map((a) => a.kind)).toEqual(["string", "expr", "expr", "shorthand", "spread", "expr"]);
    expect(attrs[0]).toMatchObject({ key: "title", value: 'Dis "claimer"' });
    expect(attrs[2]).toMatchObject({ key: "titles", expr: '["a", "b"]' });
  });

  test("setStringAttr keeps the other arguments as written", () => {
    expect(setStringAttr(' text="a"   color="blue"', "text", 'say "hi"')).toBe(` text='say "hi"' color="blue"`);
    expect(setStringAttr(' color="blue"', "text", "x")).toBe(' color="blue" text="x"');
  });

  test.each(files)("parses the components in $name", ({ text }) => {
    const calls = [...splitFrontMatter(text).body.matchAll(/\{[{%]-?\s*<([\w.]+)([^>]*?)\/?>\s*-?[}%]\}/g)];
    for (const [, , args] of calls) {
      const attrs = parseAttrs(args.replace(/\s*\/$/, ""));
      for (const attr of attrs) expect(attr.kind).not.toBe("spread");
    }
  });
});
