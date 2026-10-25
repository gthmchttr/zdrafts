// Tera syntax in Zola 0.23 content, and how zdrafts keeps it out of the Markdown parser.
//
// Content is templated before it is parsed as Markdown, so a page can contain components
//   {% <warning title="Disclaimer"> %} …markdown… {% </warning> %}   (block, with a body)
//   {{ <color text="base_url" color="blue" /> }}                     (inline, self-closing)
// and any other Tera ({{ expr }}, {% if %}, {# comment #}). encodeTera() replaces each with a
// placeholder made of private-use characters that Markdown treats as plain text, carrying the
// token itself, so the remark plugin (remark-zola.ts) can turn it back into a node.

export type Attr =
  | { kind: "string"; key: string; value: string; quote: string; raw: string }
  | { kind: "expr"; key: string; expr: string; raw: string }
  | { kind: "shorthand"; key: string; raw: string }
  | { kind: "spread"; expr: string; raw: string };

export type Token =
  /** A component with a body, on its own lines */
  | { type: "block"; name: string; args: string; body: string; open: string; close: string }
  /** A self-closing component: {{ <name … /> }} */
  | { type: "component"; name: string; args: string; raw: string }
  /** Any other Tera: expressions, statements, comments, raw blocks, inline components with bodies */
  | { type: "tera"; raw: string; block: boolean };

const START = "";
const END = "";
export const PLACEHOLDER = /([A-Za-z0-9_-]+)/g;

// --- placeholders ---------------------------------------------------------------------------

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64url(text: string): string {
  const bytes = encoder.encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unbase64url(text: string): string {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return decoder.decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

export function placeholder(token: Token): string {
  return START + base64url(JSON.stringify(token)) + END;
}

export function decodePlaceholder(encoded: string): Token {
  return JSON.parse(unbase64url(encoded)) as Token;
}

/** Exactly undo encodeTera(), including the line breaks it puts around block placeholders */
export function decodeTera(encoded: string): string {
  return encoded
    .replace(/\n(\uE000[A-Za-z0-9_-]+\uE001)\n/g, (match, ph: string) => {
      const token = decodePlaceholder(ph.slice(1, -1));
      return isBlockToken(token) ? ph : match;
    })
    .replace(PLACEHOLDER, (_, encoded: string) => tokenSource(decodePlaceholder(encoded)));
}

function isBlockToken(token: Token): boolean {
  return token.type === "block" || (token.type === "tera" && token.block);
}

/** Replace any placeholders in `text` with the source they stand for */
export function restoreTera(text: string): string {
  return text.replace(PLACEHOLDER, (_, encoded: string) => tokenSource(decodePlaceholder(encoded)));
}

export function tokenSource(token: Token): string {
  switch (token.type) {
    case "block":
      return `${token.open}${token.body}${token.close}`;
    case "component":
    case "tera":
      return token.raw;
  }
}

// --- scanning -------------------------------------------------------------------------------

/** Index just past the `close` delimiter that ends a tag opened before `from`, skipping strings and braces */
function findTagEnd(source: string, from: number, close: "%}" | "}}" | "#}"): number {
  let depth = 0;
  let quote = "";
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (close === "#}") {
      if (source.startsWith("#}", i)) return i + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (depth > 0 && (c === "}" || c === "]" || c === ")")) depth--;
    else if (depth === 0 && source.startsWith(close, i)) return i + 2;
  }
  return -1;
}

/** The text between a tag's delimiters, without whitespace control marks */
function tagInner(tag: string): string {
  return tag.slice(2, -2).replace(/^-/, "").replace(/-$/, "").trim();
}

const COMPONENT_OPEN = /^<([A-Za-z_][\w.]*)([\s\S]*?)>$/;
const COMPONENT_SELF_CLOSING = /^<([A-Za-z_][\w.]*)([\s\S]*?)\/>$/;
const COMPONENT_CLOSE = /^<\/([A-Za-z_][\w.]*)\s*>$/;

/** Find the {% </name> %} that closes a block opened just before `from`, allowing nesting */
function findBlockClose(source: string, from: number, name: string): { start: number; end: number } | null {
  let depth = 1;
  let i = from;
  while (i < source.length) {
    const start = source.indexOf("{%", i);
    if (start < 0) return null;
    const end = findTagEnd(source, start + 2, "%}");
    if (end < 0) return null;
    const inner = tagInner(source.slice(start, end));
    const close = COMPONENT_CLOSE.exec(inner);
    const open = COMPONENT_OPEN.exec(inner);
    if (close && close[1] === name && --depth === 0) return { start, end };
    if (open && open[1] === name && !inner.endsWith("/>")) depth++;
    i = end;
  }
  return null;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Replace every piece of Tera in Markdown `source` with a placeholder (see the top of the file) */
export function encodeTera(source: string): string {
  let out = "";
  let i = 0;
  let lineStart = true;

  const atLineEnd = (index: number) => /^[ \t]*(\r?\n|$)/.test(source.slice(index, index + 200));

  while (i < source.length) {
    // Fenced code is copied verbatim
    if (lineStart) {
      const fence = FENCE.exec(source.slice(i, source.indexOf("\n", i) < 0 ? undefined : source.indexOf("\n", i)));
      if (fence) {
        const marker = fence[1];
        const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`, "m");
        const afterOpen = source.indexOf("\n", i);
        let end = source.length;
        if (afterOpen >= 0) {
          const rest = source.slice(afterOpen + 1);
          const close = closing.exec(rest);
          if (close) end = afterOpen + 1 + close.index + close[0].length;
        }
        out += source.slice(i, end);
        i = end;
        lineStart = false;
        continue;
      }
    }

    const c = source[i];
    if (c === "\n") {
      out += c;
      i++;
      lineStart = true;
      continue;
    }

    // Inline code spans are copied verbatim
    if (c === "`") {
      let run = 1;
      while (source[i + run] === "`") run++;
      const ticks = "`".repeat(run);
      let search = i + run;
      let close = -1;
      while ((search = source.indexOf(ticks, search)) >= 0) {
        if (source[search + run] !== "`" && source[search - 1] !== "`") {
          close = search;
          break;
        }
        search += run;
      }
      const end = close >= 0 ? close + run : i + run;
      out += source.slice(i, end);
      i = end;
      lineStart = false;
      continue;
    }

    if (c === "{" && (source[i + 1] === "{" || source[i + 1] === "%" || source[i + 1] === "#")) {
      const startsLine = lineStart;
      const kind = source[i + 1];
      const end = findTagEnd(source, i + 2, kind === "{" ? "}}" : kind === "%" ? "%}" : "#}");
      if (end < 0) {
        out += c;
        i++;
        lineStart = false;
        continue;
      }
      const tag = source.slice(i, end);
      const inner = kind === "#" ? "" : tagInner(tag);

      if (kind === "%" && /^raw$/.test(inner)) {
        const endRaw = /\{%-?\s*endraw\s*-?%\}/g;
        endRaw.lastIndex = end;
        const match = endRaw.exec(source);
        const stop = match ? match.index + match[0].length : source.length;
        out += emit({ type: "tera", raw: source.slice(i, stop), block: startsLine && atLineEnd(stop) });
        i = stop;
        lineStart = false;
        continue;
      }

      if (kind === "%") {
        const open = COMPONENT_OPEN.exec(inner);
        if (open && !inner.endsWith("/>")) {
          const close = findBlockClose(source, end, open[1]);
          if (close) {
            const body = source.slice(end, close.start);
            const block = startsLine && atLineEnd(close.end);
            if (block) {
              out += emit({
                type: "block",
                name: open[1],
                args: open[2],
                body,
                open: tag,
                close: source.slice(close.start, close.end),
              });
            } else {
              out += emit({ type: "tera", raw: source.slice(i, close.end), block: false });
            }
            i = close.end;
            lineStart = false;
            continue;
          }
        }
      }

      if (kind === "{") {
        const component = COMPONENT_SELF_CLOSING.exec(inner);
        if (component) {
          out += emit({ type: "component", name: component[1], args: component[2].replace(/\s+$/, ""), raw: tag });
          i = end;
          lineStart = false;
          continue;
        }
      }

      out += emit({ type: "tera", raw: tag, block: startsLine && atLineEnd(end) });
      i = end;
      lineStart = false;
      continue;
    }

    out += c;
    if (c !== " " && c !== "\t") lineStart = false;
    i++;
  }
  return out;
}

/** Block tokens get a paragraph of their own so the remark plugin can find them */
function emit(token: Token): string {
  const text = placeholder(token);
  return isBlockToken(token) ? `\n${text}\n` : text;
}

// --- component arguments --------------------------------------------------------------------

/** Index just past the bracket that matches the one at `start` */
function matchBracket(source: string, start: number): number {
  let depth = 0;
  let quote = "";
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      if (--depth === 0) return i + 1;
    }
  }
  return source.length;
}

/** Parse a component's arguments, e.g. ` title="Disclaimer" open={true} {...rest}` */
export function parseAttrs(args: string): Attr[] {
  const attrs: Attr[] = [];
  let i = 0;
  while (i < args.length) {
    while (i < args.length && /\s/.test(args[i])) i++;
    if (i >= args.length) break;
    const start = i;
    if (args[i] === "{") {
      i = matchBracket(args, i);
      const raw = args.slice(start, i);
      attrs.push({ kind: "spread", expr: raw.slice(1, -1).replace(/^\.\.\./, ""), raw });
      continue;
    }
    const key = /^[A-Za-z_]\w*/.exec(args.slice(i));
    if (!key) {
      // Not something we understand: keep the rest as one opaque expression
      attrs.push({ kind: "spread", expr: args.slice(i), raw: args.slice(i) });
      break;
    }
    i += key[0].length;
    while (args[i] === " ") i++;
    if (args[i] !== "=") {
      attrs.push({ kind: "shorthand", key: key[0], raw: args.slice(start, i).trimEnd() });
      continue;
    }
    i++;
    while (args[i] === " ") i++;
    const q = args[i];
    if (q === '"' || q === "'" || q === "`") {
      let j = i + 1;
      let value = "";
      while (j < args.length && args[j] !== q) {
        if (args[j] === "\\" && j + 1 < args.length) {
          value += args[j + 1];
          j += 2;
        } else value += args[j++];
      }
      i = j + 1;
      attrs.push({ kind: "string", key: key[0], value, quote: q, raw: args.slice(start, i) });
    } else if (q === "{") {
      const end = matchBracket(args, i);
      attrs.push({ kind: "expr", key: key[0], expr: args.slice(i + 1, end - 1), raw: args.slice(start, end) });
      i = end;
    } else {
      const end = args.slice(i).search(/\s|$/);
      const expr = args.slice(i, i + end);
      attrs.push({ kind: "expr", key: key[0], expr, raw: args.slice(start, i + end) });
      i += end;
    }
  }
  return attrs;
}

/** Quote a string for Tera, picking a delimiter the value doesn't contain */
export function quoteString(value: string): string {
  for (const q of ['"', "'", "`"]) if (!value.includes(q)) return `${q}${value}${q}`;
  return `"${value.replace(/"/g, "'")}"`;
}

export function stringifyAttrs(attrs: Attr[]): string {
  return attrs.map((attr) => ` ${attr.raw}`).join("");
}

/** Set (or add) a string argument, keeping the other arguments exactly as written */
export function setStringAttr(args: string, key: string, value: string): string {
  const attrs = parseAttrs(args);
  const raw = `${key}=${quoteString(value)}`;
  const existing = attrs.findIndex((attr) => attr.kind !== "spread" && attr.key === key);
  const attr: Attr = { kind: "string", key, value, quote: raw[key.length + 1], raw };
  if (existing >= 0) attrs[existing] = attr;
  else attrs.push(attr);
  return stringifyAttrs(attrs);
}

/** Set an argument to a Tera expression (number, boolean, array…), or remove it with `null` */
export function setExprAttr(args: string, key: string, expr: string | null): string {
  const attrs = parseAttrs(args).filter((attr) => attr.kind === "spread" || attr.key !== key);
  if (expr !== null) attrs.push({ kind: "expr", key, expr, raw: `${key}={${expr}}` });
  return stringifyAttrs(attrs);
}

export function getAttr(args: string, key: string): Attr | undefined {
  return parseAttrs(args).find((attr) => attr.kind !== "spread" && attr.key === key);
}
