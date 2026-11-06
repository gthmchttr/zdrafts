// What the weekly theme check (.github/workflows/themes.yml) found: for each theme, its commits
// checked, newest first, and how every page did in each browser (tests/e2e/visual-view.spec.ts).
// Kept on the repository's theme-status branch, so checking doesn't need a deploy; the theme
// picker shows it.

export const BROWSERS = { chromium: "Chrome", firefox: "Firefox", webkit: "Safari" } as const;
export type Browser = keyof typeof BROWSERS;

export interface ThemeCheck {
  commit: string;
  /** ISO date */
  checked: string;
  browsers: Partial<Record<Browser, "passed" | "failed">>;
  /** The workflow run, for what failed */
  run?: string;
}

/** theme id → its checks, newest first */
export type ThemeStatus = Record<string, ThemeCheck[]>;

/** How many checks of a theme are kept */
export const KEPT = 10;

export const STATUS_URL: string = import.meta.env?.VITE_THEME_STATUS ?? "https://raw.githubusercontent.com/gthmchttr/zdrafts/theme-status/themes.json";

export async function fetchStatus(): Promise<ThemeStatus> {
  try {
    const response = await fetch(STATUS_URL, { cache: "no-cache" });
    return response.ok ? ((await response.json()) as ThemeStatus) : {};
  } catch {
    return {};
  }
}

/** `status` with `results` added: a check per theme and commit, its browsers merged */
export function record(status: ThemeStatus, results: { theme: string; commit: string; browser: Browser; result: "passed" | "failed"; run?: string }[], date: string): ThemeStatus {
  const next: ThemeStatus = structuredClone(status);
  for (const { theme, commit, browser, result, run } of results) {
    const checks = (next[theme] ??= []);
    let check = checks.find((candidate) => candidate.commit === commit && candidate.checked === date);
    if (!check) checks.unshift((check = { commit, checked: date, browsers: {}, run }));
    check.browsers[browser] = result;
  }
  for (const theme of Object.keys(next)) next[theme] = next[theme].slice(0, KEPT);
  return next;
}
