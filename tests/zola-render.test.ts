import { expect, test } from "vitest";
import { headingAttributes, imageAttributes, linkAttributes, markdownSettings, slug, slugifyAnchor, startsHtmlBlock, uniqueAnchor, zolaHref } from "../src/markdown/zola-render.ts";

const info = { pageUrl: "https://x.com/posts/a/", pages: { "posts/b.md": "https://x.com/posts/b/" }, markdown: markdownSettings({}) };

test("anchors as the slug crate makes them", () => {
  expect(slug("What is Zola?")).toBe("what-is-zola");
  expect(slug("Center, Left, & Right")).toBe("center-left-right");
  expect(slug("  Café crème  ")).toBe("cafe-creme");
  expect(slug("v0.23 — what's new")).toBe("v0-23-what-s-new");
  expect(slugifyAnchor("A b", "safe")).toBe("A_b");
});

test("repeated anchors are numbered", () => {
  const used = new Set(["intro", "intro-1"]);
  expect(uniqueAnchor(used, "intro")).toBe("intro-2");
  expect(uniqueAnchor(used, "other")).toBe("other");
});

test("heading attributes at the end of a heading", () => {
  expect(headingAttributes("Title {#custom .wide .note}")).toEqual({ start: 5, id: "custom", classes: ["wide", "note"] });
  expect(headingAttributes("Title")).toBeNull();
  expect(headingAttributes("{a} in the middle and not at the end")).toBeNull();
});

test("links as Zola writes them", () => {
  expect(zolaHref("@/posts/b.md", info)).toBe("https://x.com/posts/b/");
  expect(zolaHref("@/posts/b.md#part", info)).toBe("https://x.com/posts/b/#part");
  expect(zolaHref("@/posts/missing.md", info)).toBe("@/posts/missing.md");
  expect(zolaHref("#part", info)).toBe("https://x.com/posts/a/#part");
  expect(zolaHref("#", info)).toBe("#");
  expect(zolaHref("photo.png", info)).toBe("https://x.com/posts/a/photo.png");
  expect(zolaHref("/about/", info)).toBe("/about/");
  expect(zolaHref("mailto:a@b.c", info)).toBe("mailto:a@b.c");
  expect(linkAttributes("https://getzola.org", null, info)).toEqual({ href: "https://getzola.org", rel: "external" });
  const blank = { ...info, markdown: markdownSettings({ markdown: { external_links_target_blank: true, external_links_no_follow: true, external_links_class: "ext" } }) };
  expect(linkAttributes("https://getzola.org", "Zola", blank)).toEqual({ href: "https://getzola.org", title: "Zola", rel: "noopener nofollow external", target: "_blank", class: "ext" });
});

test("images as Zola writes them", () => {
  expect(imageAttributes("a.png", "A", null, info)).toEqual({ src: "https://x.com/posts/a/a.png", alt: "A" });
  const lazy = { ...info, markdown: markdownSettings({ markdown: { lazy_async_image: true } }) };
  expect(imageAttributes("/a.png", "A", "T", lazy)).toEqual({ src: "/a.png", alt: "A", title: "T", loading: "lazy", decoding: "async" });
});

test("HTML that starts an HTML block, so Markdown doesn't put it in a paragraph", () => {
  expect(startsHtmlBlock('<img src="a.png" alt="A">')).toBe(true);
  expect(startsHtmlBlock('<div class="x">\n  <p>a</p>\n</div>')).toBe(true);
  expect(startsHtmlBlock("\n\n<figure><img src=a.png></figure>")).toBe(true);
  expect(startsHtmlBlock('<span class="icon"></span>')).toBe(false);
  expect(startsHtmlBlock('<img src="a.png"> and text')).toBe(false);
  expect(startsHtmlBlock("text <div>x</div>")).toBe(false);
  expect(startsHtmlBlock("    <div>indented: code</div>")).toBe(false);
  expect(startsHtmlBlock("<!-- a comment -->")).toBe(true);
  expect(startsHtmlBlock('<a href="x">link</a>')).toBe(false);
});
