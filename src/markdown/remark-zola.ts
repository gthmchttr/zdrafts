// remark side of Zola's Tera syntax: turns encodeTera()'s placeholders into mdast nodes after
// parsing, and writes those nodes back as Tera when stringifying.
//
//   zolaBlock   {% <name args> %} children {% </name> %}   (children: the body, parsed as Markdown)
//   zolaInline  {{ <name args /> }}
//   zolaTera    any other Tera, kept verbatim (inline)
//   zolaTeraBlock  the same, on a line of its own
import type { Nodes, Parent, Root } from "mdast";
import type { Handle, Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Processor } from "unified";
import { decodePlaceholder, encodeTera, PLACEHOLDER, restoreTera, type Token } from "./tera.ts";

export interface ZolaBlock extends Parent {
  type: "zolaBlock";
  name: string;
  args: string;
  /** The original tags, reused when the arguments haven't changed */
  open?: string;
  close?: string;
}
export interface ZolaInline {
  type: "zolaInline";
  name: string;
  args: string;
  raw?: string;
}
export interface ZolaTera {
  type: "zolaTera" | "zolaTeraBlock";
  raw: string;
}

const SINGLE_PLACEHOLDER = /^\s*([A-Za-z0-9_-]+)\s*$/;

/** unified plugin: run after remark-parse (and remark-gfm) */
export function remarkZola(this: Processor) {
  const processor = this;
  return (tree: Root) => {
    transform(tree as unknown as Parent, processor);
  };
}

function parseBody(body: string, processor: Processor): Nodes[] {
  // runSync applies this plugin again, so nested components are handled too
  const root = processor.runSync(processor.parse(encodeTera(body))) as Root;
  return root.children as Nodes[];
}

function blockNode(token: Token, processor: Processor): Nodes | null {
  if (token.type === "block") {
    return {
      type: "zolaBlock",
      name: token.name,
      args: token.args,
      open: token.open,
      close: token.close,
      children: parseBody(token.body, processor),
    } as unknown as Nodes;
  }
  if (token.type === "tera" && token.block) return { type: "zolaTeraBlock", raw: token.raw } as unknown as Nodes;
  return null;
}

function inlineNode(token: Token): Nodes {
  if (token.type === "component") {
    return { type: "zolaInline", name: token.name, args: token.args, raw: token.raw } as unknown as Nodes;
  }
  return { type: "zolaTera", raw: token.type === "block" ? `${token.open}${token.body}${token.close}` : token.raw } as unknown as Nodes;
}

function transform(parent: Parent, processor: Processor) {
  const children: Nodes[] = [];
  for (const child of parent.children as Nodes[]) {
    // A paragraph that is just one block placeholder is that block
    if (child.type === "paragraph" && child.children.length === 1 && child.children[0].type === "text") {
      const match = SINGLE_PLACEHOLDER.exec(child.children[0].value);
      if (match) {
        const node = blockNode(decodePlaceholder(match[1]), processor);
        if (node) {
          children.push(node);
          continue;
        }
      }
    }
    if (child.type === "text" && child.value.includes("")) {
      children.push(...splitText(child.value));
      continue;
    }
    // Placeholders can't stay in attributes or raw HTML: put the Tera source back
    const record = child as unknown as Record<string, unknown>;
    for (const key of ["value", "url", "title", "alt"]) {
      if (typeof record[key] === "string" && (record[key] as string).includes("")) {
        record[key] = restoreTera(record[key] as string);
      }
    }
    if ("children" in child && Array.isArray(child.children)) transform(child as Parent, processor);
    children.push(child);
  }
  parent.children = children as Parent["children"];
}

function splitText(value: string): Nodes[] {
  const nodes: Nodes[] = [];
  let last = 0;
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (match.index > last) nodes.push({ type: "text", value: value.slice(last, match.index) });
    nodes.push(inlineNode(decodePlaceholder(match[1])));
    last = match.index + match[0].length;
  }
  if (last < value.length) nodes.push({ type: "text", value: value.slice(last) });
  return nodes;
}

// --- stringify ------------------------------------------------------------------------------

export function openTag(name: string, args: string): string {
  return `{% <${name}${args}> %}`;
}

export function inlineTag(name: string, args: string): string {
  return `{{ <${name}${args} /> }}`;
}

const zolaBlock: Handle = (node, _parent, state, info) => {
  const block = node as unknown as ZolaBlock;
  const originalOpen = block.open && /<[\w.]+([\s\S]*?)>\s*-?%\}$/.exec(block.open)?.[1] === block.args;
  const open = originalOpen ? block.open! : openTag(block.name, block.args);
  const close = block.close ?? `{% </${block.name}> %}`;
  // Not a real construct name, but state.enter only uses it to choose escapes
  const exit = state.enter("zolaBlock" as never);
  const inner = state.containerFlow(block as never, info);
  exit();
  return inner.trim() ? `${open}\n${inner}\n${close}` : `${open}\n${close}`;
};

const zolaInline: Handle = (node) => {
  const inline = node as unknown as ZolaInline;
  const original = inline.raw && /<[\w.]+([\s\S]*?)\s*\/>/.exec(inline.raw)?.[1]?.replace(/\s+$/, "") === inline.args;
  return original ? inline.raw! : inlineTag(inline.name, inline.args);
};

const zolaTera: Handle = (node) => (node as unknown as ZolaTera).raw;

/** Handlers for remark-stringify / mdast-util-to-markdown */
export const zolaHandlers: NonNullable<ToMarkdownOptions["handlers"]> = {
  zolaBlock,
  zolaInline,
  zolaTera,
  zolaTeraBlock: zolaTera,
} as never;
