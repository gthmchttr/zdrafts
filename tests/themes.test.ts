// The theme files (src/themes/*.toml) against the themes they describe, at their commits (npm run
// fixtures): what they name exists, and new sites from them get a Zola zdrafts has.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES as NODE_THEMES } from "../scripts/themes.ts";
import { SUPPORTED_ZOLA } from "../src/repo/site.ts";
import { THEMES } from "../src/themes/catalog.ts";
import { KEPT, record } from "../src/themes/status.ts";
import { indexComponents } from "../src/zola/components.ts";
import { themeFiles } from "./e2e/components.ts";

describe("theme files", () => {
  it("read the same in the app and in Node", () => {
    expect(THEMES).toEqual(NODE_THEMES);
    expect(THEMES.length).toBeGreaterThan(0);
  });

  for (const theme of THEMES) {
    it(`${theme.id}: makes sites with a supported Zola`, () => {
      expect(SUPPORTED_ZOLA).toContain(`v${theme.zola}`);
      expect(theme.commit).toMatch(/^[0-9a-f]{40}$/);
    });

    const dir = join(import.meta.dirname, "fixtures", "themes", theme.id);
    it.skipIf(!existsSync(dir))(`${theme.id}: names only components it has`, () => {
      const components = indexComponents(themeFiles(dir));
      expect([...theme.hiddenComponents, ...Object.keys(theme.components)].filter((name) => !components.has(name))).toEqual([]);
    });
  }
});

describe("theme status", () => {
  it("merges each browser's result into one check per commit and day, newest first", () => {
    const before = { apollo: [{ commit: "a", checked: "2026-11-02", browsers: { chromium: "passed" as const } }] };
    const after = record(
      before,
      [
        { theme: "apollo", commit: "b", browser: "chromium", result: "passed", run: "r" },
        { theme: "apollo", commit: "b", browser: "webkit", result: "failed", run: "r" },
      ],
      "2026-11-09",
    );
    expect(after.apollo).toEqual([{ commit: "b", checked: "2026-11-09", browsers: { chromium: "passed", webkit: "failed" }, run: "r" }, before.apollo[0]]);
    expect(before.apollo).toHaveLength(1);
  });

  it(`keeps a theme's last ${KEPT} checks`, () => {
    const results = Array.from({ length: KEPT + 3 }, (_, i) => ({ theme: "t", commit: `c${i}`, browser: "firefox" as const, result: "passed" as const }));
    expect(record({}, results, "2026-11-09").t.map((check) => check.commit)).toEqual(results.slice(3).reverse().map((result) => result.commit));
  });
});
