import { JSDOM } from "jsdom";
import { expect, test } from "vitest";
import { ANCHOR_ID, anchorTemplate, headingTextWithoutAnchor } from "../src/frame/anchors.ts";

const heading = (html: string) => {
  const doc = new JSDOM(`<body>${html}</body>`).window.document;
  return doc.body.firstElementChild as HTMLElement;
};

test("an anchor around the heading's text (insert_anchor_links = \"heading\")", () => {
  const h = heading('<h2 id="code-block"><a aria-label="Anchor link for: code-block" class="zola-anchor" href="#code-block">Code Block</a></h2>');
  const template = anchorTemplate(h)!;
  expect(template.mode).toBe("heading");
  expect(template.html).toBe(`<a aria-label="Anchor link for: ${ANCHOR_ID}" class="zola-anchor" href="#${ANCHOR_ID}"></a>`);
  expect(headingTextWithoutAnchor(h, template)).toBe("Code Block");
});

test("an anchor after the text (\"right\"), not counted in the heading's text", () => {
  const h = heading('<h2 id="intro">Intro <a class="anchor" href="#intro">#</a></h2>');
  const template = anchorTemplate(h)!;
  expect(template).toEqual({ mode: "right", html: `<a class="anchor" href="#${ANCHOR_ID}">#</a>` });
  expect(headingTextWithoutAnchor(h, template)).toBe("Intro");
});

test("no anchor", () => {
  expect(anchorTemplate(heading('<h2 id="a">A <a href="https://x.org">link</a></h2>'))).toBeNull();
});
