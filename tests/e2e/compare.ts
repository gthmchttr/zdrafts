// Compares a page as the Visual editor shows it with the page as Zola builds it (View): the parts
// around the page's content (the theme's chrome) and the content itself, as rendered markup.
//
// Three captures of one page:
// - `served`: the editing page as the sandbox serves it (the chrome build, src/zola/chrome.ts), with
//   the markers where the content goes;
// - `editor`: the editor's content (the ProseMirror element's innerHTML) once it has rendered;
// - `view`: the view page as served (Zola's real output).
//
// What isn't rendered doesn't count: scripts (editing removes the theme's on purpose), comments,
// whitespace between elements, the build's address (/site/ or /view/), and what the editor adds to
// its own DOM to make it editable (its classes, attributes and wrapper elements).
import { JSDOM } from "jsdom";

export interface Difference {
  /** "chrome" or "content" */
  part: string;
  /** Where, as a path of tags from the content or document root */
  at: string;
  visual: string;
  view: string;
}

const ELEMENT = 1;
const TEXT = 3;

const parse = (html: string) => new JSDOM(html).window.document;

/** Editor-only wrappers, replaced by their children */
const UNWRAP = /(^|\s)(milkdown|zd-root|zd-text|zd-slot|zd-tera|zd-unwrap)(\s|$)/;
/** Editor-only elements, left out */
const EDITOR_ONLY = /(^|\s)(ProseMirror-trailingBreak|ProseMirror-separator|ProseMirror-gapcursor|zd-handle|zd-grip|zd-error|zd-overlay|zd-editing)(\s|$)/;
/** Attributes ProseMirror adds anywhere */
const EDITOR_ATTRIBUTES = new Set(["contenteditable", "draggable", "spellcheck", "translate"]);

/** Milkdown's record of how the Markdown was written, on the elements it puts it on */
const MILKDOWN_ATTRIBUTES: Record<string, Set<string>> = {
  ul: new Set(["data-spread"]),
  ol: new Set(["data-spread"]),
  li: new Set(["data-label", "data-list-type", "data-spread", "data-item-type", "data-checked"]),
  tr: new Set(["data-is-header"]),
  pre: new Set(["data-language"]),
  br: new Set(["data-type", "data-is-inline"]),
  span: new Set(["data-is-inline"]),
};
/** Milkdown's node names in data-type (themes have their own data-type values) */
const MILKDOWN_TYPES = new Set(["hardbreak", "footnote_reference", "footnote_definition", "html"]);

/** Inline formatting that nests either way round (ProseMirror orders marks by type, not as written) */
const MARKS = new Set(["a", "strong", "b", "em", "i", "del", "s", "u", "mark", "sup", "sub", "code", "kbd"]);

/** Elements whose whitespace around and inside doesn't render (CSS block boxes, and the head's) */
const BLOCK = new Set(
  "address article aside blockquote body details dialog dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html li main nav ol p pre section summary table tbody thead tfoot tr td th ul meta link title style base".split(
    " ",
  ),
);

/** A node as compared: an element (tag, attributes, children) or text */
type Item = { tag: string; attrs: string; children: Item[] } | string;

function attributes(element: Element, editor: boolean): string {
  // Attributes the editor says it added to the site's own markup
  const added = new Set((element.getAttribute("data-zd-added") ?? "").split(/\s+/));
  return [...element.attributes]
    .map((attribute): [string, string] => [attribute.name, attribute.value])
    .filter(
      ([name, value]) =>
        !(
          editor &&
          (EDITOR_ATTRIBUTES.has(name) ||
            name.startsWith("data-zd") ||
            added.has(name) ||
            MILKDOWN_ATTRIBUTES[element.tagName.toLowerCase()]?.has(name) ||
            (name === "data-type" && MILKDOWN_TYPES.has(value)))
        ),
    )
    .map(([name, value]): [string, string] => [
      name,
      name === "style"
        ? value
            .split(";")
            .map((declaration) => declaration.trim().replace(/\s*:\s*/, ": "))
            .filter(Boolean)
            .join("; ")
        : name === "class"
        ? value
            .split(/\s+/)
            .filter((token) => token && !(editor && /^(zd-|ProseMirror)/.test(token)))
            .sort()
            .join(" ")
        : value.replace(/\s+/g, " ").trim(),
    ])
    .filter(([name, value]) => !(name === "class" && !value))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => ` ${name}="${value}"`)
    .join("");
}

/** A node's rendered children: editor additions resolved (left out or unwrapped), text merged */
function children(node: Node, editor: boolean, pre: boolean): Item[] {
  const raw: Item[] = [];
  const add = (from: Node) => {
    for (const child of from.childNodes) {
      if (child.nodeType === TEXT) {
        raw.push(child.textContent!);
        continue;
      }
      if (child.nodeType !== ELEMENT) continue;
      const element = child as Element;
      if (element.tagName === "SCRIPT" || element.tagName === "NOSCRIPT") continue;
      // The edited page's path, added by the sandbox's service worker
      if (element.tagName === "META" && element.getAttribute("name")?.startsWith("zdrafts")) continue;
      const className = element.getAttribute("class") ?? "";
      if (editor && EDITOR_ONLY.test(className)) continue;
      // Milkdown's soft line break: a span holding a space
      const softBreak = element.tagName === "SPAN" && element.getAttribute("data-type") === "hardbreak";
      if (editor && (UNWRAP.test(className) || softBreak)) add(element);
      else raw.push(item(element, editor, pre));
    }
  };
  add(node);
  // Adjacent text as one; adjacent table bodies as one (ProseMirror gives each row its own)
  const merged: Item[] = [];
  for (const entry of raw) {
    const last = merged.at(-1);
    if (typeof entry === "string" && typeof last === "string") merged[merged.length - 1] = last + entry;
    else if (typeof entry !== "string" && entry.tag === "tbody" && typeof last === "object" && last?.tag === "tbody" && last.attrs === entry.attrs) last.children.push(...entry.children);
    else merged.push(entry);
  }
  if (pre) return merged.filter((entry) => entry !== "");
  // Whitespace collapses; next to a block or a line break, or at a block's edges, it isn't rendered
  const isBlock = (entry: Item | undefined) => entry !== undefined && typeof entry !== "string" && (BLOCK.has(entry.tag) || entry.tag === "br");
  const parentBlock = node.nodeType !== ELEMENT || BLOCK.has((node as Element).tagName.toLowerCase());
  return merged
    .map((entry, i) => {
      if (typeof entry !== "string") return entry;
      let text = entry.replace(/\s+/g, " ");
      if (isBlock(merged[i - 1]) || (i === 0 && parentBlock)) text = text.replace(/^ /, "");
      if (isBlock(merged[i + 1]) || (i === merged.length - 1 && parentBlock)) text = text.replace(/ $/, "");
      return text;
    })
    .filter((entry) => entry !== "");
}

function item(element: Element, editor: boolean, pre: boolean): Item {
  const tag = element.tagName.toLowerCase();
  return nested({ tag, attrs: attributes(element, editor), children: children(element, editor, pre || tag === "pre" || tag === "textarea") });
}

/** Formatting wrapped around the same content in some order (<strong><a>x</a></strong>), in one order */
function nested(entry: Exclude<Item, string>): Item {
  const chain: Exclude<Item, string>[] = [entry];
  for (let inner = entry.children[0]; entry.children.length && typeof inner !== "string" && MARKS.has(chain.at(-1)!.tag) && chain.at(-1)!.children.length === 1 && MARKS.has(inner.tag); inner = inner.children[0]) {
    chain.push(inner);
    if (inner.children.length !== 1) break;
  }
  if (chain.length < 2) return entry;
  const content = chain.at(-1)!.children;
  return [...chain]
    .sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .reduceRight<Item[]>((inside, wrapper) => [{ tag: wrapper.tag, attrs: wrapper.attrs, children: inside }], content)[0];
}

/** An item written out, to compare and to show */
function describe(entry: Item): string {
  if (typeof entry === "string") return entry;
  return `<${entry.tag}${entry.attrs}>${entry.children.map(describe).join("")}</${entry.tag}>`;
}

const label = (entry: Item) => (typeof entry === "string" ? "#text" : entry.tag);

/**
 * The differences between two lists of items. Items the same on both sides are matched up first
 * (longest common subsequence); between them, items are paired in order, and an element that
 * differs only inside is gone into. What's left over on one side is missing on the other.
 */
function differences(part: string, at: string, visual: Item[], view: Item[]): Difference[] {
  const a = visual.map(describe);
  const b = view.map(describe);
  const common = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  }
  const found: Difference[] = [];
  let onlyVisual: number[] = [];
  let onlyView: number[] = [];
  const flush = () => {
    for (let k = 0; k < Math.max(onlyVisual.length, onlyView.length); k++) {
      const x = onlyVisual[k] === undefined ? undefined : visual[onlyVisual[k]];
      const y = onlyView[k] === undefined ? undefined : view[onlyView[k]];
      const here = `${at}/${label((x ?? y)!)}[${onlyVisual[k] ?? onlyView[k]}]`;
      if (x === undefined || y === undefined) found.push({ part, at: here, visual: x === undefined ? "(nothing)" : describe(x), view: y === undefined ? "(nothing)" : describe(y) });
      else if (typeof x !== "string" && typeof y !== "string" && x.tag === y.tag && x.attrs === y.attrs) found.push(...differences(part, here, x.children, y.children));
      else found.push({ part, at: here, visual: describe(x), view: describe(y) });
    }
    onlyVisual = [];
    onlyView = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j >= b.length || (i < a.length && common[i + 1][j] >= common[i][j + 1])) onlyVisual.push(i++);
    else onlyView.push(j++);
  }
  flush();
  return found;
}

/** Whether a node is rendered (an element that isn't a script, or text that isn't only whitespace) */
const shows = (node: Node) =>
  (node.nodeType === ELEMENT && !["SCRIPT", "NOSCRIPT"].includes((node as Element).tagName)) || (node.nodeType === TEXT && !!node.textContent!.trim());

/** Where the content goes in the editing page: its parent's path, and how many shown nodes come before and after it */
function contentPlace(doc: Document): { path: number[]; before: number; after: number; start: Comment; end: Comment } {
  const walker = doc.createTreeWalker(doc.body, 128 /* comments */);
  let start: Comment | null = null;
  let end: Comment | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const data = (node as Comment).data;
    if (data.includes("zdrafts:content:")) start = node as Comment;
    else if (data.includes("zdrafts:end:")) end = node as Comment;
  }
  if (!start || !end || start.parentNode !== end.parentNode) throw new Error("The editing page has no content markers");
  const parent = start.parentNode!;
  const path: number[] = [];
  for (let node: Node = parent; node !== doc.body; node = node.parentNode!) path.unshift([...node.parentNode!.childNodes].filter(shows).indexOf(node as ChildNode));
  const siblings = [...parent.childNodes];
  return {
    path,
    before: siblings.slice(0, siblings.indexOf(start)).filter(shows).length,
    after: siblings.slice(siblings.indexOf(end) + 1).filter(shows).length,
    start,
    end,
  };
}

/** The differences between a page in Visual and in View (none: the same) */
export function compare({ served, editor, view, base }: { served: string; editor: string; view: string; base: { site: string; view: string } }): Difference[] {
  const visualDoc = parse(served.replaceAll(base.site, "BASE"));
  const viewDoc = parse(view.replaceAll(base.view, "BASE"));

  // The content's place in View: the same parent, minus the chrome before and after it
  const place = contentPlace(visualDoc);
  let parent: Node = viewDoc.body;
  for (const index of place.path) {
    const next = [...parent.childNodes].filter(shows)[index];
    if (!next) return [{ part: "chrome", at: `body > ${place.path.join(" > ")}`, visual: "(the content's container)", view: "(nothing there)" }];
    parent = next;
  }
  const siblings = [...parent.childNodes].filter(shows);
  const content = siblings.slice(place.before, siblings.length - place.after);

  // The chrome: both documents without the content
  const visualSiblings = [...place.start.parentNode!.childNodes];
  for (const node of visualSiblings.slice(visualSiblings.indexOf(place.start), visualSiblings.indexOf(place.end) + 1)) node.remove();
  const contentHolder = viewDoc.createElement("div");
  for (const node of content) contentHolder.append(node);
  const found = differences("chrome", "", children(visualDoc, false, false), children(viewDoc, false, false));

  // The content: the editor's against Zola's, as the children of the content's container
  const containerTag = (parent as Element).tagName;
  const wrap = (html: string) => parse(`<body><${containerTag}>${html}</${containerTag}></body>`).body.firstElementChild!;
  let editorItems = children(wrap(editor.replaceAll(base.site, "BASE")), true, false);
  // An empty page is an empty paragraph to type in
  if (editorItems.length === 1 && typeof editorItems[0] !== "string" && editorItems[0].tag === "p" && !editorItems[0].children.length) editorItems = [];
  const viewItems = children(wrap(contentHolder.innerHTML), false, false);
  found.push(...differences("content", "", editorItems, viewItems));
  return found;
}
