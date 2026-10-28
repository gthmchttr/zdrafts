import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { Nodes, Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { describe, expect, test } from "vitest";
import { joinFrontMatter, splitFrontMatter } from "../src/markdown/frontmatter.ts";
import { htmlHandlers, htmlJoin, remarkHtml } from "../src/markdown/remark-html.ts";
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
  .use(remarkStringify, { handlers: { ...zolaHandlers, ...htmlHandlers }, join: [htmlJoin], encode: [] } as never)
  .use(remarkGfm)
  .use(remarkZola)
  .use(remarkHtml);

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

describe("html", () => {
  const types = (tree: Root) => collect(tree, ["htmlContainer", "htmlInline", "html"]).map((t) => t.split(":")[0]);
  const same = (body: string) => expect(stringify(parse(body))).toBe(body);

  test("inline tags become elements and are written back as they were", () => {
    const body = "Edit <u>zola.toml</u> and press <kbd>Ctrl</kbd> + <kbd>S</kbd>.\n";
    expect(types(parse(body))).toEqual(["htmlInline", "htmlInline", "htmlInline"]);
    same(body);
  });

  test("colour and highlight, nested, with Markdown inside", () => {
    const body = 'A <span style="color: #e5484d"><mark>red **bold**</mark></span> word.\n';
    expect(types(parse(body))).toEqual(["htmlInline", "htmlInline"]);
    same(body);
  });

  test("a block wrapper around Markdown", () => {
    const body = '<div style="text-align: center">\n\nHello **there**\n\n* a list\n\n</div>\n';
    const tree = parse(body);
    expect(types(tree)).toEqual(["htmlContainer"]);
    expect((tree.children[0] as unknown as { children: unknown[] }).children).toHaveLength(2);
    same(body);
  });

  test("columns: containers inside a container", () => {
    const body = '<div style="display: grid">\n<div>\n\nOne\n\n</div>\n<div>\n\nTwo\n\n</div>\n</div>\n';
    expect(types(parse(body))).toEqual(["htmlContainer", "htmlContainer", "htmlContainer"]);
    same(body);
  });

  test("details with a summary", () => {
    const body = "<details>\n<summary>More</summary>\n\nHidden *text*\n\n</details>\n";
    const tree = parse(body);
    expect(types(tree)).toEqual(["htmlContainer"]);
    expect((tree.children[0] as unknown as { summary: string }).summary).toBe("<summary>More</summary>");
    same(body);
  });

  test("inside components", () => {
    const body = '{% <border> %}\n<div style="text-align: right">\n\nRight\n\n</div>\n{% </border> %}\n';
    expect(types(parse(body))).toEqual(["htmlContainer"]);
    same(body);
  });

  test("empty elements stay HTML", () => {
    const body = '<progress></progress>\n<progress value="33" max="100"></progress>\n\nText with <span></span> nothing.\n';
    expect(types(parse(body)).filter((type) => type !== "html")).toEqual([]);
    same(body);
  });

  test("unpaired tags and raw HTML stay as they are", () => {
    const body = "<div>\n\nNever closed\n\n<p>Some <b>raw</b> html</p>\n\nA lone </span> here.\n";
    expect(types(parse(body))).toEqual(["html", "html", "html"]);
    same(body);
  });
});
