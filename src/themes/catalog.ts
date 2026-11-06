// Zola themes zdrafts can start a new site with, at the commit they were tested at: each page of
// each theme's demo site renders the same in Visual as Zola builds it (tests/e2e/visual-view.spec.ts).
// Themes on servers that don't let browsers download from them can't be listed.

export interface CatalogTheme {
  id: string;
  name: string;
  description: string;
  /** Repository on GitHub, Codeberg or GitLab */
  repo: string;
  /** The tested commit */
  commit: string;
  license: string;
  demo: string;
  screenshot: string;
}

export const CATALOG: CatalogTheme[] = [
  {
    id: "zola-yolk",
    name: "zola-yolk",
    description: "A minimal, dark monospace Zola theme with search, Font Awesome icons, and a component-based template architecture.",
    repo: "https://github.com/gauthamchettiar/zola-yolk",
    commit: "d6acdba59c06d9f9e0380d2b4e63d6ab6a78068f",
    license: "MIT",
    demo: "",
    screenshot: "",
  },
  {
    id: "apollo",
    name: "apollo",
    description: "Modern and minimalistic blog theme",
    repo: "https://github.com/not-matthias/apollo",
    commit: "31e30e27638aa68394d8625e5c49ad3b8310bf65",
    license: "MIT",
    demo: "https://not-matthias.github.io/apollo",
    screenshot: "https://www.getzola.org/themes/apollo/screenshot.png",
  },
];
