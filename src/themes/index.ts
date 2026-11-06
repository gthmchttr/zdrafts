// How the editor fits a theme. Every theme gets the generic adapter; a theme's file
// (src/themes/<id>.toml) can add hints (menu labels, CSS to show content it hides), but no theme
// needs one to work.
import { THEMES } from "./catalog.ts";

export interface ThemeAdapter {
  id: string;
  name: string;
  /** Extra CSS for the page while editing, e.g. to show content the theme hides */
  editCss: string;
  /** Components that only make sense in templates (they take the page, etc.) */
  hiddenComponents: string[];
  /** Slash-menu labels, descriptions and Codicon names for components */
  componentHints: Record<string, { label?: string; description?: string; icon?: string; keywords?: string[] }>;
}

// Collapsed sections are opened while editing, so what's inside can be edited
const GENERIC_CSS = `details:not([open]) > :not(summary) { display: block !important; }`;

export function findTheme(theme: string | null): ThemeAdapter {
  const known = THEMES.find((candidate) => candidate.id === theme);
  if (!known) return { id: "generic", name: theme ?? "site templates", editCss: GENERIC_CSS, hiddenComponents: [], componentHints: {} };
  return { id: known.id, name: known.name, editCss: `${GENERIC_CSS}\n${known.editCss}`, hiddenComponents: known.hiddenComponents, componentHints: known.components };
}
