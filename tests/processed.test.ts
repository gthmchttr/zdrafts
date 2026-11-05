import { expect, test } from "vitest";
import { processedStem, ProcessedImages } from "../src/zola/processed.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

test("processed image names give their source's stem", () => {
  expect(processedStem("blog_a_record.ee0b62b036d1a821.webp")).toBe("blog_a_record");
  expect(processedStem("my.photo.0123456789abcdef.jpg")).toBe("my.photo");
});

test("resized images are fed back until their source changes", () => {
  const images = new ProcessedImages();
  const files = new Map([
    ["static/a.png", bytes("one")],
    ["content/post/b.jpg", bytes("two")],
  ]);
  const sources = images.sources(files);
  images.record(
    new Map([
      ["processed_images/a.0123456789abcdef.webp", bytes("A")],
      ["processed_images/b.fedcba9876543210.webp", bytes("B")],
      ["index.html", bytes("<p>")],
    ]),
    sources,
    false,
  );
  expect([...images.inputs(images.sources(files)).keys()].sort()).toEqual([
    "static/processed_images/a.0123456789abcdef.webp",
    "static/processed_images/b.fedcba9876543210.webp",
  ]);

  // Same path, new contents: Zola would reuse the old resized image, so it's dropped
  files.set("static/a.png", bytes("changed"));
  expect([...images.inputs(images.sources(files)).keys()]).toEqual(["static/processed_images/b.fedcba9876543210.webp"]);

  // Deleted source: dropped too
  files.delete("content/post/b.jpg");
  expect([...images.inputs(images.sources(files)).keys()]).toEqual([]);
});

test("a complete build drops the resized images it didn't use; the editing build doesn't", () => {
  const images = new ProcessedImages();
  const files = new Map([["static/a.png", bytes("one")]]);
  const sources = images.sources(files);
  images.record(new Map([["processed_images/a.0123456789abcdef.webp", bytes("A")]]), sources, false);
  images.record(new Map([["index.html", bytes("<p>")]]), sources, false);
  expect(images.inputs(sources).size).toBe(1);
  images.record(new Map([["index.html", bytes("<p>")]]), sources, true);
  expect(images.inputs(sources).size).toBe(0);
});
