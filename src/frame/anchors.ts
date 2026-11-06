// Heading anchors (insert_anchor_links): Zola renders the theme's anchor-link.html template into
// each heading, which the editor can't render. It learns the markup from a heading Zola rendered in
// the page as served (the chrome build keeps the page's headings), with the id as a placeholder.
import type { AnchorTemplate } from "../markdown/zola-render.ts";

/** Stands for the heading's id in the template (survives HTML parsing, unlike control characters) */
export const ANCHOR_ID = "zdrafts-anchor-id";

/** `id` where it stands as a whole in attribute values ("#intro", "Anchor link for: intro") */
const idPattern = (id: string, flags = "") => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, flags);

/** An element with an attribute naming `id` */
const refersTo = (element: Element, id: string) => [...element.attributes].some((attribute) => idPattern(id).test(attribute.value));

/** The anchor template in a heading Zola rendered, if it has one */
export function anchorTemplate(heading: HTMLElement): AnchorTemplate | null {
  const id = heading.id;
  if (!id) return null;
  const links = [...heading.querySelectorAll("*")].filter((element) => refersTo(element, id));
  if (!links.length) return null;
  const marked = (element: Element) => {
    const clone = element.cloneNode(true) as Element;
    for (const attribute of [...clone.attributes]) clone.setAttribute(attribute.name, attribute.value.replace(idPattern(id, "g"), ANCHOR_ID));
    return clone;
  };
  // insert_anchor_links = "heading": a link around the heading's text
  const text = heading.textContent!.trim();
  const around = links.find((link) => text && link.textContent!.trim() === text);
  if (around) {
    const clone = marked(around);
    clone.replaceChildren();
    return { mode: "heading", html: clone.outerHTML };
  }
  // "left" or "right": the link before or after the text
  let child: Element = links[0];
  while (child.parentElement !== heading) child = child.parentElement!;
  const nodes = [...heading.childNodes];
  const before = nodes.slice(0, nodes.indexOf(child)).some((node) => node.textContent!.trim());
  return { mode: before ? "right" : "left", html: marked(child).outerHTML };
}

/** A heading's own text, without its anchor (for "left" and "right", which add some) */
export function headingTextWithoutAnchor(heading: HTMLElement, template: AnchorTemplate | null): string {
  if (!template || template.mode === "heading") return heading.textContent!.trim();
  const clone = heading.cloneNode(true) as HTMLElement;
  for (const element of [...clone.querySelectorAll("*")]) if (refersTo(element, heading.id)) element.remove();
  return clone.textContent!.trim();
}
