// Keep a file's own formatting for everything the user didn't edit.
//
// Milkdown serializes the whole document, normalizing spacing, tables, hard breaks and so on. A
// one-word edit would then rewrite the entire file. Instead, both the edited document and the
// unedited one (the "baseline", serialized the same way) are split into top-level blocks; blocks
// of the edit that equal a baseline block are replaced by the original source of that block.
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { encodeTera, restoreTera } from "./tera.ts";

interface Block {
  /** The block's text, with Tera in placeholder form (for comparison) */
  key: string;
  start: number;
  end: number;
}

const parser = unified().use(remarkParse).use(remarkGfm);

/** Top-level blocks of `markdown` with their offsets in it, or null if they can't be located */
export function splitBlocks(markdown: string): Block[] | null {
  const encoded = encodeTera(markdown);
  const blocks: Block[] = [];
  let cursor = 0;
  for (const node of parser.parse(encoded).children) {
    const { start, end } = node.position ?? {};
    if (start?.offset === undefined || end?.offset === undefined) return null;
    const key = encoded.slice(start.offset, end.offset);
    // Find the block's source in the unencoded text; only whitespace may lie between blocks
    const source = restoreTera(key);
    const at = markdown.indexOf(source, cursor);
    if (at < 0 || markdown.slice(cursor, at).trim() !== "") return null;
    blocks.push({ key, start: at, end: at + source.length });
    cursor = at + source.length;
  }
  return markdown.slice(cursor).trim() === "" ? blocks : null;
}

/**
 * `edited` with every block that is unchanged from `baseline` written as it was in `original`.
 * `baseline` must be the serialization of `original` before any edit.
 */
export function preserveSource(original: string, baseline: string, edited: string): string {
  if (edited === baseline) return original;
  const source = splitBlocks(original);
  const base = splitBlocks(baseline);
  const next = splitBlocks(edited);
  // The baseline must line up with the original block for block, or nothing can be mapped
  if (!source || !base || !next || source.length !== base.length || next.length === 0) return edited;

  const baseKeys = base.map((b) => baseline.slice(b.start, b.end));
  const nextKeys = next.map((b) => edited.slice(b.start, b.end));
  const match = lcs(nextKeys, baseKeys);

  // Changed blocks that replace as many original blocks one for one take those blocks' places,
  // so the spacing around them stays as it was
  const place = [...match];
  for (let j = 0; j < next.length; ) {
    if (match[j] !== null) {
      j++;
      continue;
    }
    let end = j;
    while (end < next.length && match[end] === null) end++;
    const before = j > 0 ? match[j - 1]! : -1;
    const after = end < next.length ? match[end]! : source.length;
    if (after - before - 1 === end - j) for (let k = j; k < end; k++) place[k] = before + 1 + (k - j);
    j = end;
  }

  let out = source.length ? original.slice(0, source[0].start) : "";
  next.forEach((block, j) => {
    const i = place[j];
    const previous = j > 0 ? place[j - 1] : null;
    if (j > 0) out += i !== null && previous !== null && i === previous + 1 ? original.slice(source[previous].end, source[i].start) : "\n\n";
    out += match[j] === null ? edited.slice(block.start, block.end) : original.slice(source[i!].start, source[i!].end);
  });
  const tail = source.length ? original.slice(source[source.length - 1].end) : "\n";
  return out + tail;
}

/** For each item of `a`, the index of the item of `b` it pairs with in a longest common subsequence */
function lcs(a: string[], b: string[]): (number | null)[] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i * cols + j] = a[i] === b[j] ? table[(i + 1) * cols + j + 1] + 1 : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1]);
  const result: (number | null)[] = new Array(a.length).fill(null);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) result[i++] = j++;
    else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) i++;
    else j++;
  }
  return result;
}
