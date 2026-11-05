// How Zola renders parts of a page's Markdown that the editor shows itself (components and code
// come from Zola): heading ids, links and images. Ports of Zola 0.23's rules
// (components/markdown/src/markdown.rs, components/utils/src/slugs.rs), so a page looks in the
// editor as Zola builds it.

/** What the editor needs to know to render a page as Zola does */
export interface RenderInfo {
  /** The page's URL ("https://…/posts/a/"): `#anchor` and relative links are made absolute with it */
  pageUrl: string;
  /** Content files' URLs, for @/ links: "posts/a.md" → URL */
  pages: Record<string, string>;
  /** The site's [markdown] and [slugify] settings that change what's rendered */
  markdown: MarkdownSettings;
  /** The ids Zola gave the page's own headings (not ones in components), in order, by their text */
  headings: { text: string; id: string }[];
}

export interface MarkdownSettings {
  externalLinksTargetBlank: boolean;
  externalLinksNoFollow: boolean;
  externalLinksNoReferrer: boolean;
  externalLinksExternal: boolean;
  externalLinksClass: string | null;
  lazyAsyncImage: boolean;
  definitionList: boolean;
  bottomFootnotes: boolean;
  slugifyAnchors: "on" | "safe" | "off";
}

/** Zola's [markdown] and [slugify] settings from a site's parsed config, with its defaults */
export function markdownSettings(config: Record<string, unknown>): MarkdownSettings {
  const markdown = (config.markdown ?? {}) as Record<string, unknown>;
  const slugify = (config.slugify ?? {}) as Record<string, unknown>;
  const flag = (key: string, fallback: boolean) => (typeof markdown[key] === "boolean" ? (markdown[key] as boolean) : fallback);
  return {
    externalLinksTargetBlank: flag("external_links_target_blank", false),
    externalLinksNoFollow: flag("external_links_no_follow", false),
    externalLinksNoReferrer: flag("external_links_no_referrer", false),
    externalLinksExternal: flag("external_links_external", true),
    externalLinksClass: typeof markdown.external_links_class === "string" ? markdown.external_links_class : null,
    lazyAsyncImage: flag("lazy_async_image", false),
    definitionList: flag("definition_list", false),
    bottomFootnotes: flag("bottom_footnotes", false),
    slugifyAnchors: slugify.anchors === "safe" || slugify.anchors === "off" ? slugify.anchors : "on",
  };
}

/**
 * The slug crate's slugify, which Zola uses for anchors: ASCII letters and digits kept (lowercased),
 * anything else one dash between them. Zola transliterates other characters (deunicode); here only
 * accents come off, so headings in other scripts take their ids from Zola's build (RenderInfo.headings).
 */
export function slug(text: string): string {
  const ascii = text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  return ascii
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function slugifyAnchor(text: string, strategy: MarkdownSettings["slugifyAnchors"]): string {
  return strategy === "on" ? slug(text) : text.replace(/[ \t\n\f\r]/g, "_");
}

/** An id not used yet: the slug, else slug-1, slug-2… (Zola's find_anchor) */
export function uniqueAnchor(used: Set<string>, name: string): string {
  if (!used.has(name)) return name;
  for (let level = 1; ; level++) if (!used.has(`${name}-${level}`)) return `${name}-${level}`;
}

/**
 * A heading's attributes block at the end of its line ("Title {#id .class}", pulldown-cmark's heading
 * attributes, which Zola turns on): where it starts in the text, its id and classes.
 */
export function headingAttributes(text: string): { start: number; id: string | null; classes: string[] } | null {
  const match = /[ \t]*\{([^{}]*)\}[ \t]*$/.exec(text);
  if (!match) return null;
  let id: string | null = null;
  const classes: string[] = [];
  for (const token of match[1].trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith("#") && token.length > 1) id = token.slice(1);
    else if (token.startsWith(".") && token.length > 1) classes.push(token.slice(1));
  }
  return { start: match.index, id, classes };
}

const isExternal = (link: string) => link.startsWith("http:") || link.startsWith("https:");

/** Where a link or image in the page points once Zola has rendered it (fix_link) */
export function zolaHref(link: string, info: Pick<RenderInfo, "pageUrl" | "pages">): string {
  if (link.startsWith("@/")) {
    const [path, anchor] = link.slice(2).split(/(?=#)/);
    const url = info.pages[path];
    return url ? `${url}${anchor ?? ""}` : link;
  }
  // Colocated with the page: relative, no scheme
  if (!link.startsWith("/") && !link.startsWith("..") && !link.startsWith("#") && !/^[0-9A-Za-z-]+:/.test(link)) return `${info.pageUrl}${link}`;
  if (isExternal(link) || link === "#") return link;
  if (link.startsWith("#")) return `${info.pageUrl}${link}`;
  return link;
}

/** The attributes Zola gives a link: its href, and for external links the site's settings */
export function linkAttributes(href: string, title: string | null, info: Pick<RenderInfo, "pageUrl" | "pages" | "markdown">): Record<string, string> {
  const attrs: Record<string, string> = { href: zolaHref(href, info) };
  if (title) attrs.title = title;
  const settings = info.markdown;
  if (isExternal(href)) {
    const rel = [
      settings.externalLinksTargetBlank && "noopener",
      settings.externalLinksNoFollow && "nofollow",
      settings.externalLinksNoReferrer && "noreferrer",
      settings.externalLinksExternal && "external",
    ].filter(Boolean);
    if (rel.length) attrs.rel = rel.join(" ");
    if (settings.externalLinksTargetBlank) attrs.target = "_blank";
    if (settings.externalLinksClass) attrs.class = settings.externalLinksClass;
  }
  return attrs;
}

/** The attributes Zola gives an image */
export function imageAttributes(src: string, alt: string, title: string | null, info: Pick<RenderInfo, "pageUrl" | "pages" | "markdown">): Record<string, string> {
  const attrs: Record<string, string> = { src: zolaHref(src, info), alt };
  if (title) attrs.title = title;
  if (info.markdown.lazyAsyncImage) Object.assign(attrs, { loading: "lazy", decoding: "async" });
  return attrs;
}

const BLOCK_TAGS =
  "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
const ATTRIBUTE = `\\s+[A-Za-z_:][\\w.:-]*(?:\\s*=\\s*(?:[^\\s"'=<>\`]+|'[^']*'|"[^"]*"))?`;

/**
 * Whether HTML put in the Markdown on a line of its own starts an HTML block (CommonMark's start
 * conditions 1 to 7), which Markdown passes through as it is: no <p> around it. Zola renders a
 * page's components into its Markdown before rendering the Markdown, so a component alone in its
 * paragraph gets a <p> only when its HTML doesn't start a block.
 */
export function startsHtmlBlock(html: string): boolean {
  // Its first line with something on it; four spaces in, it would be code
  const rest = html.replace(/^([ \t]*\n)+/, "");
  if (/^ {4}/.test(rest)) return false;
  const text = rest.split("\n")[0].trim();
  if (!text) return false;
  if (/^<(pre|script|style|textarea)(\s|>|$)/i.test(text)) return true;
  if (/^(<!--|<\?|<![A-Za-z]|<!\[CDATA\[)/.test(text)) return true;
  if (new RegExp(`^</?(${BLOCK_TAGS})(\\s|/?>|$)`, "i").test(text)) return true;
  // A complete open or closing tag, alone on the line (not script, style, pre or textarea)
  return new RegExp(`^(<(?!(script|style|pre|textarea)\\b)[A-Za-z][A-Za-z0-9-]*(${ATTRIBUTE})*\\s*/?>|</[A-Za-z][A-Za-z0-9-]*\\s*>)\\s*$`, "i").test(text);
}
