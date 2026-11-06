// A page calling each component a theme offers pages (those in the / menu) that its demo pages
// don't use, so that the end-to-end test checks every one of them: added to the theme's demo
// content as the test serves it (github.ts). A call is the theme file's `example` for it, or
// else one as the / menu makes it, with its defaults.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThemeManifest } from "../../src/themes/manifest.ts";
import { defaultArgs, indexComponents, isTemplateOnly, type ComponentInfo } from "../../src/zola/components.ts";

export const COMPONENTS_PAGE = "content/zdrafts-components.md";

/** The templates and content of a checkout */
export function themeFiles(dir: string): Map<string, Uint8Array> {
  const paths = execFileSync("git", ["-C", dir, "ls-files"], { maxBuffer: 1 << 26 })
    .toString()
    .split("\n")
    .filter((path) => /^(templates|content)\//.test(path));
  return new Map(paths.map((path) => [path, readFileSync(join(dir, path))]));
}

function call(component: ComponentInfo): string {
  const args = defaultArgs(component);
  if (component.block) return `{% <${component.name}${args}> %}\nSome **text** in ${component.name}.\n{% </${component.name}> %}`;
  if (component.textParam) return `Some {{ <${component.name}${args} text="${component.name}" /> }} text.`;
  return `{{ <${component.name}${args} /> }}`;
}

/** The components page for a theme, or null when its demo pages use all its components */
export function componentsPage(theme: ThemeManifest, files: Map<string, Uint8Array>): { names: string[]; markdown: string } | null {
  const hidden = new Set(theme.hiddenComponents);
  const unused = [...indexComponents(files).values()]
    .filter((component) => !component.usedInContent && !hidden.has(component.name) && !isTemplateOnly(component))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!unused.length) return null;
  const calls = unused.map((component) => `## ${component.name}\n\n${theme.components[component.name]?.example?.trim() ?? call(component)}`);
  return {
    names: unused.map((component) => component.name),
    markdown: `+++\ntitle = "Components"\ndate = 2024-01-01\n+++\n\nEach component of ${theme.name} its demo pages don't use.\n\n${calls.join("\n\n")}\n`,
  };
}
