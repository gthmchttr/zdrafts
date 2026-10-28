// Creating, moving and renaming files in a site: names, new pages' front matter, and keeping links
// to a moved file working.

/** A file or folder name from what someone typed: "My first post!" → "my-first-post" */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

/** Front matter for a new page or section, in the format the site's other pages use */
export function newPageText(title: string, kind: "page" | "section", format: "toml" | "yaml", date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const lines = format === "yaml" ? [`title: ${JSON.stringify(title)}`] : [`title = ${JSON.stringify(title)}`];
  if (kind === "page") lines.push(format === "yaml" ? `date: ${day}` : `date = ${day}`);
  const fence = format === "yaml" ? "---" : "+++";
  return `${fence}\n${lines.join("\n")}\n${fence}\n\n`;
}

/** The site URL of a static file: static/images/a.png → /images/a.png */
export const staticUrl = (path: string) => `/${path.replace(/^static\//, "")}`;

/** The internal link to a page: content/blog/a.md → @/blog/a.md */
export const internalLink = (path: string) => `@/${path.replace(/^content\//, "")}`;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` with links to a moved file pointing at its new place: internal links (@/…) to a page, or
 * URLs of a static file, wherever they appear as a whole (Markdown links, HTML, component args).
 */
export function rewriteLinks(text: string, from: string, to: string): string {
  if (from.startsWith("content/") && to.startsWith("content/")) {
    const pattern = new RegExp(`${escape(internalLink(from))}(?=$|[\\s)"'#?>\\]])`, "g");
    return text.replace(pattern, internalLink(to));
  }
  if (from.startsWith("static/") && to.startsWith("static/")) {
    const pattern = new RegExp(`(^|[\\s("'=<])${escape(staticUrl(from))}(?=$|[\\s)"'#?>])`, "g");
    return text.replace(pattern, (_, before: string) => `${before}${staticUrl(to)}`);
  }
  return text;
}

/** Whether a file may go into a folder: pages stay under content/, other files under content/ or static/ */
export function canMoveInto(path: string, folder: string): boolean {
  if (path.split("/").slice(0, -1).join("/") === folder) return false;
  if (path.endsWith(".md")) return folder === "content" || folder.startsWith("content/");
  return folder === "static" || folder.startsWith("static/") || folder === "content" || folder.startsWith("content/");
}
