import { expect, test } from "vitest";
import { downloadedUpFront, missingFiles, servedFiles, sitePath } from "../src/repo/lazy.ts";

test("what's downloaded when a site opens", () => {
  expect(downloadedUpFront("content/posts/a.md")).toBe(true);
  expect(downloadedUpFront("templates/page.html")).toBe(true);
  expect(downloadedUpFront("themes/t/templates/page.html")).toBe(true);
  // Zola resizes or reads these
  expect(downloadedUpFront("static/images/a.JPG")).toBe(true);
  expect(downloadedUpFront("themes/t/static/data.json")).toBe(true);
  // Zola only copies these
  expect(downloadedUpFront("static/icons/a.svg")).toBe(false);
  expect(downloadedUpFront("themes/t/static/js/mermaid.min.js")).toBe(false);
  expect(downloadedUpFront("static/video.mp4")).toBe(false);
});

test("static files' place on the site", () => {
  expect(sitePath("static/icons/a.svg")).toBe("icons/a.svg");
  expect(sitePath("themes/t/static/icons/a.svg")).toBe("icons/a.svg");
  expect(sitePath("content/a.md")).toBeNull();
});

test("the files a failed build was missing, however its error names them", () => {
  const notDownloaded = ["static/css/site.css", "themes/t/static/js/x.js", "static/data/other.bin", "static/a b.svg"];
  expect(missingFiles(["ERROR Reason: error: `get_url`: Could not find or open file css/site.css"], notDownloaded)).toEqual(["static/css/site.css"]);
  expect(missingFiles(["ERROR Reason: error: `get_hash`: Cannot find file: js/x.js"], notDownloaded)).toEqual(["themes/t/static/js/x.js"]);
  expect(missingFiles(["ERROR Reason: error: `load_data`: /site/static/data/other.bin doesn't exist"], notDownloaded)).toEqual(["static/data/other.bin"]);
  expect(missingFiles(["ERROR Failed to render section '/site/content/_index.md'", "--> t/templates/index.html:3:1"], notDownloaded)).toEqual([]);
});

test("the site's static files over its theme's; other themes' aren't served", () => {
  const served = servedFiles(["themes/t/static/a.svg", "static/a.svg", "themes/t/static/b.svg", "themes/other/static/c.svg"], "t");
  expect(Object.fromEntries(served)).toEqual({ "a.svg": "static/a.svg", "b.svg": "themes/t/static/b.svg" });
});
