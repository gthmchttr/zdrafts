import { expect, test } from "vitest";
import { chromeOverrides, findPages, headingLines, wordCount } from "../src/zola/chrome.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

test("headings for the table of contents: not in code, not in components' bodies", () => {
  const body = [
    "## One",
    "```",
    "## In code",
    "```",
    "{% <row> %}",
    "{% <col> %}",
    "### In a component",
    "{% </col> %}",
    "{% </row> %}",
    '{% note(title="x") %}',
    "## In a shortcode",
    "{% end %}",
    '{{ <icon name="x" /> }}',
    "## Two {{ <mark text=\"y\" /> }}",
  ].join("\n");
  expect(headingLines(body)).toEqual(["## One", "## Two"]);
});

test("words as Zola counts them: not between ``` pairs; letters in Chinese and Japanese", () => {
  expect(wordCount("Hello world, it's 3.14!", "en")).toBe(4);
  expect(wordCount("hello world ``` code goes here ``` goodbye world", "en")).toBe(4);
  expect(wordCount("你好世界，这是中文测试。", "zh")).toBe(10);
});

test("the chrome build's body counts as many words as the page's, and its markers none", () => {
  const page = "+++\ntitle = \"A\"\n+++\n\n## Heading\n\nSome words in a paragraph, then more ```skipped``` words.\n";
  const chrome = decoder.decode(chromeOverrides(["content/a.md"], () => page).get("content/a.md"));
  const body = chrome.slice(chrome.indexOf("+++\n", 3) + 4);
  expect(wordCount(body, "en")).toBe(wordCount(page.slice(page.indexOf("+++\n", 3) + 4), "en"));
  expect(findPages(new Map([["a/index.html", encoder.encode(`<main>${body}</main>`)]]))).toEqual(new Map([["content/a.md", "a/index.html"]]));
});
