// Every page of each catalog theme's demo site (a new site made from the theme, as people make
// them) must render in Visual exactly as Zola builds it (View), apart from what makes the editor
// editable: see compare.ts for what's compared. Run with `npm run test:e2e` after
// `npm run fixtures`. E2E_CAPTURE=<dir> keeps each page's captures there, to look at.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { CATALOG } from "../../src/themes/catalog.ts";
import { compare, type Difference } from "./compare.ts";
import { mockGitHub } from "./github.ts";

/** Poll `probe` every half second until it gives the same value three times in a row */
async function settled<T>(page: Page, probe: () => Promise<T | null>, what: string, tries = 240): Promise<T> {
  let last: string | null = null;
  let same = 0;
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(500);
    const value = await probe().catch(() => null);
    const key = value === null ? null : JSON.stringify(value);
    if (key !== null && key === last) {
      if (++same >= 2) return value as T;
    } else same = 0;
    last = key;
  }
  throw new Error(`${what} didn't settle`);
}

/** The editing frame of `path` once its editor has rendered everything (components included) */
async function editor(page: Page, path: string): Promise<{ frame: Frame; html: string }> {
  return settled(
    page,
    async () => {
      const frame = page.frames().find((candidate) => candidate.url().includes(`zdrafts-edit=${encodeURIComponent(path)}`));
      if (!frame) return null;
      const html = await frame.evaluate(() => document.querySelector(".zd-root .ProseMirror")?.innerHTML ?? null);
      return html === null ? null : { frame, html };
    },
    `The editor for ${path}`,
  );
}

function report(path: string, differences: Difference[]): string {
  return differences
    .slice(0, 25)
    .map((d) => `${path} [${d.part}] at ${d.at}\n    visual: ${d.visual.slice(0, 400)}\n    view:   ${d.view.slice(0, 400)}`)
    .join("\n");
}

for (const theme of CATALOG) {
  test(`${theme.name}: every page renders in Visual as Zola builds it`, async ({ page, context }) => {
    await mockGitHub(context);
    await page.goto("/new");
    await page.getByRole("option", { name: theme.name }).click();
    await page.getByPlaceholder("My site").fill("Test");
    await page.getByRole("button", { name: "Create site" }).click();
    await page.getByText("Built in").first().waitFor({ timeout: 5 * 60_000 });

    // Every folder open, then every page
    for (let open = await page.locator('[role="treeitem"][aria-expanded="false"]').count(); open; open = await page.locator('[role="treeitem"][aria-expanded="false"]').count()) {
      await page.locator('[role="treeitem"][aria-expanded="false"]').first().click();
    }
    const pages = (await page.locator('[role="treeitem"][data-path^="content/"][data-path$=".md"]').evaluateAll((rows) => rows.map((row) => row.getAttribute("data-path")!))).sort();
    expect(pages.length).toBeGreaterThan(0);

    for (const path of pages) {
      await test.step(path, async () => {
        await page.locator(`[role="treeitem"][data-path="${path}"]`).click();
        const visualButton = page.getByRole("button", { name: "Visual", exact: true });
        // A page whose template doesn't show its content is only edited as Markdown
        if (!(await visualButton.isVisible())) return;
        await visualButton.click();
        const { frame, html } = await editor(page, path);
        const sandbox = new URL(frame.url()).origin;
        // And it can be edited: the editor read all of it
        const notice = await frame.evaluate(() => document.querySelector(".zd-error")?.textContent ?? (document.querySelector(".zd-root .ProseMirror")?.getAttribute("contenteditable") === "true" ? null : "not editable"));
        expect.soft(notice, `${path} can't be edited`).toBeNull();
        const served = await frame.evaluate(() => fetch(location.href).then((response) => response.text()));

        await page.getByRole("button", { name: "View", exact: true }).click();
        const view = await settled(
          page,
          async () => {
            const viewFrame = page.frames().find((candidate) => new URL(candidate.url()).pathname.startsWith("/view/"));
            if (!viewFrame || (await viewFrame.evaluate(() => document.readyState)) !== "complete") return null;
            return viewFrame.evaluate(() => fetch(location.href).then((response) => response.text()));
          },
          `The view of ${path}`,
        );
        await page.getByRole("button", { name: "Visual", exact: true }).click();

        const base = { site: `${sandbox}/site`, view: `${sandbox}/view` };
        if (process.env.E2E_CAPTURE) {
          const dir = join(process.env.E2E_CAPTURE, theme.id);
          mkdirSync(dir, { recursive: true });
          writeFileSync(join(dir, `${path.replace(/\W+/g, "_")}.json`), JSON.stringify({ path, served, editor: html, view, base }));
        }
        const differences = compare({ served, editor: html, view, base });
        expect.soft(report(path, differences), `${path}: ${differences.length} difference(s) between Visual and View`).toBe("");
      });
    }
  });
}
