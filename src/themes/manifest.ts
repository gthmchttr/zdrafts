// A theme's file in src/themes/<id>.toml: what zdrafts knows about it. The catalog (themes a new
// site can start from), how the editor fits it, and what the tests check of it all come from there.
import { parse } from "smol-toml";

export interface ComponentHint {
  label?: string;
  description?: string;
  icon?: string;
  keywords?: string[];
  /**
   * A call of it for the tests, when its demo pages don't use it and a call with its defaults
   * doesn't show it (tests/components.ts)
   */
  example?: string;
}

export interface ThemeManifest {
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
  /** The Zola it's tested with, and new sites from it are made for */
  zola: string;
  /** In the catalog: new sites can start from it */
  catalog: boolean;
  /** Extra CSS for the page while editing, e.g. to show content it hides */
  editCss: string;
  /** Components only for its templates that zdrafts can't tell are (src/zola/components.ts) */
  hiddenComponents: string[];
  components: Record<string, ComponentHint>;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export function parseManifest(id: string, text: string): ThemeManifest {
  const data = parse(text) as Record<string, any>;
  for (const key of ["name", "repo", "commit", "zola"]) {
    if (typeof data[key] !== "string" || !data[key]) throw new Error(`src/themes/${id}.toml: ${key} is missing`);
  }
  const components: Record<string, ComponentHint> = {};
  for (const [name, hint] of Object.entries((data.components ?? {}) as Record<string, any>)) {
    components[name] = {
      label: hint.label,
      description: hint.description,
      icon: hint.icon,
      keywords: hint.keywords && strings(hint.keywords),
      example: hint.example,
    };
  }
  return {
    id,
    name: data.name,
    description: data.description ?? "",
    repo: data.repo,
    commit: data.commit,
    license: data.license ?? "",
    demo: data.demo ?? "",
    screenshot: data.screenshot ?? "",
    zola: data.zola,
    catalog: data.catalog !== false,
    editCss: data.edit?.css ?? "",
    hiddenComponents: strings(data.edit?.hidden),
    components,
  };
}

/** The manifests of `{ "<dir>/<id>.toml": text }` */
export function parseManifests(files: Record<string, string>): ThemeManifest[] {
  return Object.entries(files)
    .map(([path, text]) => parseManifest(path.replace(/^.*\//, "").replace(/\.toml$/, ""), text))
    .sort((a, b) => a.id.localeCompare(b.id));
}
