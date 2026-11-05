import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { codiconsCss } from "../src/shell/codicons-css.ts";
import { CODICONS } from "../src/shell/codicons.ts";

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
  );
}

test("every codicon the UI names is built into its CSS", () => {
  const named = new Set<string>();
  for (const file of sources(join(import.meta.dirname, "../src/shell"))) {
    for (const [, name] of readFileSync(file, "utf8").matchAll(/codicon-([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w$-])/g)) named.add(name);
  }
  const missing = [...named].filter((name) => !(CODICONS as readonly string[]).includes(name));
  expect(missing).toEqual([]);
});

test("each icon's SVG exists", () => {
  expect(codiconsCss().match(/\.codicon-[\w-]+\{/g)).toHaveLength(CODICONS.length);
});
