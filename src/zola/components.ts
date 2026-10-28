// The Tera components a site can use in its content, read from its (and its theme's) templates:
//   {% component admonition(title = "", icon = "circle-info", color = "yellow") %} … {% endcomponent %}

export interface ComponentParam {
  name: string;
  /** Declared type (`src: string`), if any */
  type: string | null;
  /** Default value as Tera source, e.g. `"md"` or `false`; null when required */
  default: string | null;
  /** `@name`: taken from the caller's context, not passed by content */
  implicit: boolean;
}

export interface ComponentInfo {
  name: string;
  params: ComponentParam[];
  /** Uses `body`, so it wraps content: {% <name> %}…{% </name> %} */
  block: boolean;
  /** Has a plain string `text` parameter, so its text can be edited in place */
  textParam: boolean;
  file: string;
  /** Called from the site's or theme's templates */
  usedInTemplates: boolean;
  /** Called from the site's content */
  usedInContent: boolean;
}

const COMPONENT = /\{%-?\s*component\s+([A-Za-z_][\w.]*)\s*\(([\s\S]*?)\)\s*-?%\}([\s\S]*?)\{%-?\s*endcomponent\b/g;

/** Split a parameter list on top-level commas */
function splitParams(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const c of source) {
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function parseParam(source: string): ComponentParam | null {
  if (source.startsWith("...")) return null;
  const match = /^(@?)([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?\s*(?:=\s*([\s\S]+))?$/.exec(source);
  if (!match) return null;
  return { name: match[2], type: match[3] ?? null, default: match[4]?.trim() ?? null, implicit: match[1] === "@" };
}

/** Every component defined in `templates/` of the site and its themes */
export function indexComponents(files: Map<string, Uint8Array>): Map<string, ComponentInfo> {
  const decoder = new TextDecoder();
  const components = new Map<string, ComponentInfo>();
  // Theme templates first, so the site's own definitions win
  const templates = [...files.keys()]
    .filter((path) => /(^|\/)templates\/.+\.(html|xml|txt|md)$/.test(path))
    .sort((a, b) => Number(!a.startsWith("themes/")) - Number(!b.startsWith("themes/")));
  for (const path of templates) {
    const text = decoder.decode(files.get(path)!);
    for (const match of text.matchAll(COMPONENT)) {
      const [, name, paramSource, body] = match;
      const params = splitParams(paramSource).map(parseParam).filter((p): p is ComponentParam => p !== null);
      const text = params.find((p) => p.name === "text" && !p.implicit);
      components.set(name, {
        name,
        params,
        block: /\bbody\b/.test(body),
        textParam: !!text && (text.type === null || text.type === "string"),
        file: path,
        usedInTemplates: false,
        usedInContent: false,
      });
    }
  }
  // Where each is called: {{ <name … /> }} or {% <name …> %}
  for (const [path, data] of files) {
    const template = /(^|\/)templates\/.+\.(html|xml|txt|md)$/.test(path);
    const content = path.startsWith("content/") && path.endsWith(".md");
    if (!template && !content) continue;
    const text = decoder.decode(data);
    for (const match of text.matchAll(/(?:\{\{|\{%)-?\s*<([A-Za-z_][\w.]*)/g)) {
      const component = components.get(match[1]);
      if (!component) continue;
      if (template) component.usedInTemplates = true;
      else component.usedInContent = true;
    }
  }
  return components;
}

/** Default arguments for a new instance of a component: its required parameters, with placeholders */
export function defaultArgs(component: ComponentInfo): string {
  return component.params
    .filter((p) => !p.implicit && p.default === null && p.name !== "text")
    .map((p) => {
      switch (p.type) {
        case "bool":
        case "boolean":
          return ` ${p.name}={false}`;
        case "integer":
        case "number":
          return ` ${p.name}={0}`;
        case "array":
          return ` ${p.name}={[]}`;
        default:
          return ` ${p.name}=""`;
      }
    })
    .join("");
}

/** Parameters that are template context: a component needing one is used by templates, not pages */
const CONTEXT_PARAMS = new Set(["page", "section", "config", "paginator", "term", "taxonomy", "lang", "current_path", "current_url", "macros", "pages", "subsections"]);

/**
 * Whether a component is a building block of the theme's templates rather than something to put
 * in a page: templates call it and pages don't, it needs template context (the page, the
 * config…) or a map, or it's named privately.
 */
export function isTemplateOnly(component: ComponentInfo): boolean {
  if (component.name.split(".").some((part) => part.startsWith("_"))) return true;
  // The theme's templates call it, and no page does
  if (component.usedInTemplates && !component.usedInContent) return true;
  return component.params.some((p) => !p.implicit && p.default === null && (CONTEXT_PARAMS.has(p.name) || p.type === "map"));
}
