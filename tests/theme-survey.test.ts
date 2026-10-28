// Checks how zdrafts does with Zola themes, by building a new site with each theme the way zdrafts
// does: a normal build, the chrome build (page bodies replaced by markers) and component probes.
// Not part of `npm test`; run with
//   THEMES_DIR=<dir of theme repositories> ZOLA_WASI_JS=<zola-wasi web/src/index.js> ZOLA_WASM=<zola.wasm> \
//     npx vitest run tests/theme-survey.test.ts
// and read <THEMES_DIR>/../survey.json.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, test } from "vitest";
import { prepareSite } from "../src/site/newsite.ts";
import { chromeOverrides, findPages, previewConfig } from "../src/zola/chrome.ts";
import { defaultArgs, indexComponents, isTemplateOnly } from "../src/zola/components.ts";
import { parseProbe, probePage, type ProbeCall } from "../src/zola/probe.ts";
import { probeContext } from "../src/zola/probecontext.ts";

const THEMES_DIR = process.env.THEMES_DIR;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readTree(root: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(root, path), new Uint8Array(readFileSync(path)));
    }
  };
  walk(root);
  return files;
}

const errors = (stderr: string[]) => stderr.filter((line) => !/^(Building site|Checking|-> |Done in|Creating)/.test(line)).slice(-4).join(" ").slice(0, 400);

describe.skipIf(!THEMES_DIR)("theme survey", () => {
  test("every theme", { timeout: 3_600_000 }, async () => {
    // The DOM parseProbe needs
    globalThis.DOMParser = new JSDOM().window.DOMParser as unknown as typeof DOMParser;
    const { loadZola } = await import(process.env.ZOLA_WASI_JS!);
    const zola = await loadZola(readFileSync(process.env.ZOLA_WASM!));
    const report: Record<string, unknown>[] = [];
    const only = process.env.THEME ? [process.env.THEME] : readdirSync(THEMES_DIR!).sort();
    for (const name of only) {
      const entry: Record<string, unknown> = { theme: name };
      report.push(entry);
      try {
        const theme = readTree(join(THEMES_DIR!, name));
        const baseUrl = "http://localhost:5173/site";
        const options = { themeName: name, title: "Survey", zolaVersion: "0.23.6" };
        const prepared = await prepareSite(theme, options, (files) => zola.build({ files, baseUrl, drafts: true }));
        if (prepared.dropped.length) entry.droppedDemoPages = prepared.dropped;
        if (prepared.starter) entry.starter = true;
        if (prepared.error) {
          entry.build = `FAILED: ${prepared.error.slice(-400)}`;
          continue;
        }
        const site = prepared.files;
        // Preview builds, as zdrafts does them
        const config = [...site.keys()].includes("zola.toml") ? "zola.toml" : "config.toml";
        const preview = previewConfig(decoder.decode(site.get(config)));
        const build = (overrides: Map<string, Uint8Array | null> = new Map()) => {
          const files = new Map(site);
          if (preview !== null) files.set(config, encoder.encode(preview));
          for (const [path, data] of overrides) data === null ? files.delete(path) : files.set(path, data);
          return zola.build({ files, baseUrl, drafts: true });
        };

        const pages = [...site.keys()].filter((path) => path.startsWith("content/") && path.endsWith(".md")).sort();
        const text = (path: string) => decoder.decode(site.get(path));
        const chrome = await build(chromeOverrides(pages, text));
        entry.chrome = chrome.ok ? "ok" : `FAILED: ${errors(chrome.stderr)}`;
        let probeOn: string | undefined;
        if (chrome.ok) {
          // What the theme's inline <head> scripts do (zdrafts keeps those while editing)
          const sample = [...chrome.files].find(([path]) => path.endsWith("index.html"))?.[1];
          const head = sample ? decoder.decode(sample).split(/<\/head>/i)[0] : "";
          const inline = [...head.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1].replace(/\s+/g, " ").trim()).filter(Boolean);
          if (inline.length) entry.headScripts = inline.map((script) => script.slice(0, 160));
          const found = findPages(chrome.files);
          const missing = pages.filter((path) => !found.has(path));
          entry.pages = `${found.size}/${pages.length}`;
          // Components are probed as if on an editable page, as the app does
          probeOn = [...found.keys()].find((path) => !path.endsWith("_index.md")) ?? [...found.keys()][0];
          if (missing.length) entry.notVisual = missing.slice(0, 8);
        }

        // The components the / menu offers
        const components = [...indexComponents(site).values()];
        const offered = components.filter((c) => !isTemplateOnly(c));
        entry.components = `${offered.length} offered, ${components.length - offered.length} template-only`;
        if (offered.length) {
          const calls: ProbeCall[] = offered.map((c) => ({ kind: c.block ? "block" : c.textParam ? "text" : "atom", name: c.name, args: c.textParam && !c.block ? `${defaultArgs(c)} text="x"` : defaultArgs(c) }));
          const context = probeContext(probeOn ?? pages[0], (path) => (site.has(path) ? decoder.decode(site.get(path)) : undefined), [...site.keys()]);
          const render = async (batch: ProbeCall[]) => {
            const files = new Map<string, Uint8Array | null>([["content/__zdrafts__/probe-0/index.md", encoder.encode(probePage(batch, context.frontMatter))]]);
            for (const [relative, source] of context.assets) files.set(`content/__zdrafts__/probe-0/${relative}`, site.get(source)!);
            const probe = await build(files);
            const html = probe.ok ? probe.files.get("__zdrafts__/probe-0/index.html") : undefined;
            return html ? parseProbe(decoder.decode(html), batch) : null;
          };
          // One build for all, or one each when a call fails (as the app does)
          const results = (await render(calls)) ?? (await Promise.all(calls.map(async (call) => (await render([call]))?.[0] ?? { html: "", slot: false, error: "fails" })));
          const failed = calls.filter((_, i) => !results[i].html || results[i].error).map((c) => c.name);
          entry.probes = `${calls.length - failed.length}/${calls.length} render with default arguments, ${results.filter((r) => r.slot).length} editable in place`;
          if (failed.length) entry.needArguments = failed;
        }
      } catch (error) {
        entry.error = String(error).slice(0, 300);
      }
      console.log(JSON.stringify(entry));
    }
    writeFileSync(join(dirname(THEMES_DIR!), "survey.json"), JSON.stringify(report, null, 2));
    expect(report.length).toBeGreaterThan(0);
  });
});
