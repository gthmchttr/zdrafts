// The themes zdrafts knows (src/themes/<id>.toml, see manifest.ts). Those in the catalog are the
// ones a new site can start from, at the commit they were tested at: each page of each theme's demo
// site, and each of its components, renders the same in Visual as Zola builds it
// (tests/e2e/visual-view.spec.ts). Themes on servers that don't let browsers download from them
// can't be listed.
import { parseManifests, type ThemeManifest } from "./manifest.ts";

export type CatalogTheme = ThemeManifest;

export const THEMES: ThemeManifest[] = parseManifests(import.meta.glob<string>("./*.toml", { query: "?raw", import: "default", eager: true }));

export const CATALOG: CatalogTheme[] = THEMES.filter((theme) => theme.catalog);
