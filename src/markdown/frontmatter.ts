// Zola pages start with TOML (+++) or YAML (---) front matter. zdrafts edits it separately from
// the body, as text, so its formatting and comments survive.

export interface SplitDocument {
  /** The front matter block including its delimiters and trailing newline, or "" */
  frontMatter: string;
  /** Everything after it */
  body: string;
  format: "toml" | "yaml" | null;
}

const FRONT_MATTER = /^(\+\+\+|---)[ \t]*\r?\n([\s\S]*?)(?:\r?\n)?\1[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(text: string): SplitDocument {
  const match = FRONT_MATTER.exec(text);
  if (!match) return { frontMatter: "", body: text, format: null };
  return {
    frontMatter: match[0],
    body: text.slice(match[0].length),
    format: match[1] === "+++" ? "toml" : "yaml",
  };
}

export function joinFrontMatter(frontMatter: string, body: string): string {
  if (!frontMatter) return body;
  const separator = frontMatter.endsWith("\n") || body === "" ? "" : "\n";
  return frontMatter + separator + body;
}

/** The inner text of a front matter block, without its delimiters */
export function frontMatterContent(frontMatter: string): string {
  const match = FRONT_MATTER.exec(frontMatter);
  return match ? match[2] : "";
}
