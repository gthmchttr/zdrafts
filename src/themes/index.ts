// Themes zdrafts has been tested with. Editing a page inside a theme's own markup depends on how
// its templates and components are written, so each supported theme gets an adapter here.
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

export function findTheme(theme: string | null, files: Map<string, Uint8Array>): ThemeAdapter | null {
  return THEMES.find((adapter) => adapter.matches(theme, files)) ?? null;
}
