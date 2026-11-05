// Builds the CSS for the codicons in CODICONS (src/shell/codicons.ts): each a mask of its SVG, in
// the text's colour, sized by font-size like the icon font it replaces. Used by vite.config.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CODICONS } from "./codicons.ts";

const require = createRequire(import.meta.url);

export function codiconsCss(): string {
  const rules = CODICONS.map((name) => {
    const svg = readFileSync(require.resolve(`@vscode/codicons/src/icons/${name}.svg`), "utf8").replace(/\s+/g, " ").trim();
    return `.codicon-${name}{--codicon:url("data:image/svg+xml,${encodeURIComponent(svg)}")}`;
  });
  return [
    ".codicon{display:inline-block;width:1em;height:1em;font-size:16px;flex-shrink:0;vertical-align:-0.125em;background-color:currentColor;" +
      "-webkit-mask:var(--codicon) center/contain no-repeat;mask:var(--codicon) center/contain no-repeat}",
    ...rules,
  ].join("\n");
}
