// Components are rendered (probed) as if they were on the page being edited: with the template
// that page uses, its front matter (templates read its date, [extra]…) and its co-located files (an image
// component may look for page.colocated_path ~ src). Not every theme has a page.html, and
// components can depend on all three.
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { frontMatterContent, splitFrontMatter } from "../markdown/frontmatter.ts";

/** A section's file: _index.md, or a translation like _index.fr.md */
export const isSectionFile = (path: string) => /(^|\/)_index(\.[\w-]+)?\.md$/.test(path);

/** A translation of a page (post.fr.md, _index.de.md) rather than the default language's */
export const isTranslation = (path: string) => /\.[a-z]{2,3}(-[\w]+)?\.md$/i.test(path);

/** Front matter keys the probe page doesn't copy: they'd give it the page's URL, or list it */
const LEFT_OUT = new Set(["title", "path", "slug", "aliases", "taxonomies", "tags", "categories"]);

export interface ProbeContext {
  /** Same id, same rendering: results are shared */
  id: string;
  /** Front matter for the probe page, with its delimiters */
  frontMatter: string;
  /** The edited page's co-located files: path relative to its folder → path in the site */
  assets: Map<string, string>;
}

/** A front matter value, from TOML or (simply) YAML */
function frontMatterValue(text: string, key: string): unknown {
  const { frontMatter, format } = splitFrontMatter(text);
  if (!frontMatter) return undefined;
  const inner = frontMatterContent(frontMatter);
  if (format === "toml") {
    try {
      return (parseToml(inner) as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  }
  const match = new RegExp(`^${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, "m").exec(inner);
  return match?.[1];
}

/**
 * How to probe components for `page`: `text` reads a file of the site (undefined when there's
 * none), `files` lists them.
 */
export function probeContext(page: string, text: (path: string) => string | undefined, files: string[]): ProbeContext {
  const source = text(page) ?? "";
  const folder = page.split("/").slice(0, -1).join("/");
  const isSection = isSectionFile(page);

  // The template a page here renders with: its own, or the closest section's page_template
  let template = isSection ? undefined : frontMatterValue(source, "template");
  for (let dir = isSection ? folder : folder; !template && dir.startsWith("content"); dir = dir.split("/").slice(0, -1).join("/")) {
    const section = text(`${dir}/_index.md`);
    if (section !== undefined) template = frontMatterValue(section, "page_template");
    if (dir === "content") break;
  }

  // The page's own front matter (templates read its date, description, [extra]…), without what
  // gives it a URL or lists it somewhere
  const { frontMatter, format } = splitFrontMatter(source);
  const inner = frontMatter ? frontMatterContent(frontMatter) : "";
  let matter: string;
  if (format === "yaml") {
    const lines = inner.split(/\r?\n/);
    const kept: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const key = /^([A-Za-z_][\w-]*)\s*:/.exec(lines[i])?.[1];
      if (key && (LEFT_OUT.has(key) || (isSection && key !== "extra"))) {
        while (i + 1 < lines.length && /^\s+\S|^\s*-\s/.test(lines[i + 1])) i++;
        continue;
      }
      kept.push(lines[i]);
    }
    if (typeof template === "string" && !/^template\s*:/m.test(inner)) kept.push(`template: ${JSON.stringify(template)}`);
    matter = `---\ntitle: "zdrafts probe"\n${kept.join("\n").trim()}\n---\n`;
  } else {
    let values: Record<string, unknown> = {};
    try {
      values = format === "toml" ? (parseToml(inner) as Record<string, unknown>) : {};
    } catch {
      values = {};
    }
    const copy: Record<string, unknown> = { title: "zdrafts probe" };
    // A section's settings (sort_by, paginate_by…) aren't a page's: only its [extra] carries over
    for (const [key, value] of Object.entries(values)) if (!LEFT_OUT.has(key) && (!isSection || key === "extra")) copy[key] = value;
    if (typeof template === "string" && template) copy.template = template;
    try {
      matter = `+++\n${stringifyToml(copy)}+++\n`;
    } catch {
      matter = `+++\ntitle = "zdrafts probe"\n${typeof template === "string" ? `template = ${JSON.stringify(template)}\n` : ""}+++\n`;
    }
  }

  // A page bundle (folder/index.md) has its files beside it
  const assets = new Map<string, string>();
  if (page.endsWith("/index.md")) {
    for (const path of files) {
      if (path.startsWith(`${folder}/`) && !path.endsWith(".md")) assets.set(path.slice(folder.length + 1), path);
    }
  }
  const id = JSON.stringify([matter, assets.size ? folder : null]);
  return { id, frontMatter: matter, assets };
}
