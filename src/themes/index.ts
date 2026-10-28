// How the editor fits a theme. Every theme gets the generic adapter; an adapter here can add hints
// for a theme (menu labels, CSS to show content it hides) but isn't needed for a theme to work.
import { zolaYolk } from "./zola-yolk.ts";

export interface ThemeAdapter {
  id: string;
  name: string;
  /** Does this adapter fit the site? */
  matches(theme: string | null, files: Map<string, Uint8Array>): boolean;
  /** Extra CSS for the page while editing, e.g. to show content the theme hides */
  editCss: string;
  /** Components that only make sense in templates (they take the page, etc.) */
  hiddenComponents: string[];
  /** Slash-menu labels, descriptions and Codicon names for components */
  componentHints: Record<string, { label?: string; description?: string; icon?: string; keywords?: string[] }>;
}

export const THEMES: ThemeAdapter[] = [zolaYolk];

/** Any theme (or a site without one) */
export const genericTheme: ThemeAdapter = {
  id: "generic",
  name: "",
  matches: () => true,
  // Collapsed sections are opened while editing, so what's inside can be edited
  editCss: `details:not([open]) > :not(summary) { display: block !important; }`,
  hiddenComponents: [],
  componentHints: {},
};

export function findTheme(theme: string | null, files: Map<string, Uint8Array>): ThemeAdapter {
  const adapter = THEMES.find((candidate) => candidate.matches(theme, files)) ?? genericTheme;
  return adapter === genericTheme ? { ...genericTheme, name: theme ?? "site templates" } : adapter;
}
