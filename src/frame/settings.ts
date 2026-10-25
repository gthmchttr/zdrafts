// Settings popovers: a component's arguments (generated from its declared parameters), and the
// image and link insert forms.
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { getAttr, setExprAttr, setStringAttr } from "../markdown/tera.ts";
import type { ComponentInfo, ComponentParam } from "../zola/components.ts";
import { componentElements } from "./nodes.ts";
import type { Field, Overlay } from "./overlay.ts";
import type { Probes } from "./probes.ts";

export interface SettingsEnv {
  overlay: Overlay;
  components: Map<string, ComponentInfo>;
  probes: Probes;
  staticImages: string[];
  markDirty: () => void;
}

const isBool = (p: ComponentParam) => p.type === "bool" || p.type === "boolean" || p.default === "true" || p.default === "false";
const isNumber = (p: ComponentParam) => p.type === "integer" || p.type === "number" || p.type === "float" || /^-?\d+(\.\d+)?$/.test(p.default ?? "");
const unquote = (value: string) => value.replace(/^(["'`])([\s\S]*)\1$/, "$2");

/** What the form shows for a parameter: the call's value, else the default */
function currentValue(args: string, param: ComponentParam): string | boolean {
  const attr = getAttr(args, param.name);
  if (isBool(param)) {
    if (attr?.kind === "expr") return attr.expr.trim() === "true";
    return param.default === "true";
  }
  if (attr?.kind === "string") return attr.value;
  if (attr?.kind === "expr") return isNumber(param) ? attr.expr : `{${attr.expr}}`;
  if (attr?.kind === "shorthand") return `{${attr.key}}`;
  return "";
}

/** The call's arguments after the form's values are applied */
function applyValues(args: string, params: ComponentParam[], values: Record<string, string | boolean>): string {
  let next = args;
  for (const param of params) {
    if (!(param.name in values)) continue;
    const value = values[param.name];
    const before = currentValue(args, param);
    if (value === before) continue;
    if (typeof value === "boolean") {
      const isDefault = param.default === String(value);
      next = setExprAttr(next, param.name, isDefault ? null : String(value));
    } else if (value === "" && param.default !== null) {
      next = setExprAttr(next, param.name, null);
    } else if (/^\{[\s\S]*\}$/.test(value)) {
      next = setExprAttr(next, param.name, value.slice(1, -1));
    } else if (isNumber(param) && /^-?\d+(\.\d+)?$/.test(value)) {
      next = setExprAttr(next, param.name, value);
    } else {
      next = setStringAttr(next, param.name, value);
    }
  }
  return next;
}

export function openComponentSettings(env: SettingsEnv, element: HTMLElement) {
  const entry = componentElements.get(element);
  const pos = entry?.getPos();
  if (!entry || pos === undefined) return;
  const { view } = entry;
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const { name, args } = node.attrs as { name: string; args: string };
  const info = env.components.get(name);
  const isBlock = node.type.name === "zola_block";
  const isText = node.type.name === "zola_text";

  if (!name) {
    // Plain Tera: only the source can be edited
    env.overlay.openForm({
      anchor: element.getBoundingClientRect(),
      title: "Tera",
      note: "Template code, kept exactly as written.",
      fields: [{ key: "raw", label: "Source", value: node.attrs.raw }],
      actions: [
        { label: "Apply", run: (values) => replaceAttrs(view, pos, { raw: String(values.raw) }, env) },
        { label: "Delete", kind: "danger", run: () => deleteNode(view, pos, env) },
      ],
    });
    return;
  }

  const params = (info?.params ?? []).filter((p) => !p.implicit && !(isText && p.name === "text"));
  const fields: Field[] = params.map((param) => ({
    key: param.name,
    label: param.name,
    value: currentValue(args, param),
    hint: param.default === null ? "required" : `default ${unquote(param.default)}`,
  }));
  const kind = isBlock ? "block" : isText ? "text" : "atom";
  const probe = env.probes.get({ kind, name, args });
  const datalist = params.some((p) => p.name === "src") ? env.staticImages.map((path) => path.replace(/^static/, "")) : undefined;

  env.overlay.openForm({
    anchor: element.getBoundingClientRect(),
    title: isBlock ? `{% <${name}> %}` : `{{ <${name} /> }}`,
    note: info ? undefined : "This component isn't defined in the site's templates.",
    error: probe?.error,
    fields,
    datalist,
    actions: [
      { label: "Apply", run: (values) => replaceAttrs(view, pos, { args: applyValues(args, params, values) }, env) },
      ...(isBlock ? [{ label: "Unwrap", kind: "secondary" as const, run: () => unwrap(view, pos, env) }] : []),
      { label: "Delete", kind: "danger" as const, run: () => deleteNode(view, pos, env) },
    ],
  });
}

function replaceAttrs(view: EditorView, pos: number, attrs: Record<string, unknown>, env: SettingsEnv) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  const next = { ...node.attrs, ...attrs };
  if (JSON.stringify(next) === JSON.stringify(node.attrs)) return;
  env.markDirty();
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, next));
  view.focus();
}

function deleteNode(view: EditorView, pos: number, env: SettingsEnv) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  env.markDirty();
  view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize));
  view.focus();
}

/** Replace a block component with its content */
function unwrap(view: EditorView, pos: number, env: SettingsEnv) {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return;
  env.markDirty();
  view.dispatch(view.state.tr.replaceWith(pos, pos + node.nodeSize, node.content));
  view.focus();
}

export function openImageForm(env: SettingsEnv, view: EditorView) {
  const { from } = view.state.selection;
  const coords = view.coordsAtPos(from);
  env.overlay.openForm({
    anchor: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top),
    title: "Image",
    note: "A path under static/ starts with /, e.g. /202609/photo.png. A file next to the page can be referenced by its name.",
    fields: [
      { key: "src", label: "Path or URL", value: "" },
      { key: "alt", label: "Alt text", value: "" },
    ],
    datalist: env.staticImages.map((path) => path.replace(/^static/, "")),
    actions: [
      {
        label: "Insert",
        run: (values) => {
          if (!values.src) return;
          env.markDirty();
          const image = view.state.schema.nodes.image.create({ src: String(values.src), alt: String(values.alt) });
          view.dispatch(view.state.tr.replaceSelectionWith(image).scrollIntoView());
          view.focus();
        },
      },
    ],
  });
}

export function openLinkForm(env: SettingsEnv, view: EditorView) {
  const { from, to } = view.state.selection;
  const selected = view.state.doc.textBetween(from, to);
  const coords = view.coordsAtPos(from);
  env.overlay.openForm({
    anchor: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top),
    title: "Link",
    note: "Link to another page with @/path/to/page.md, or paste a URL.",
    fields: [
      { key: "text", label: "Text", value: selected },
      { key: "href", label: "URL", value: "" },
    ],
    actions: [
      {
        label: "Insert",
        run: (values) => {
          const href = String(values.href);
          const text = String(values.text) || href;
          if (!href) return;
          env.markDirty();
          const { schema } = view.state;
          const node = schema.text(text, [schema.marks.link.create({ href })]);
          const tr = view.state.tr.replaceWith(from, to, node);
          view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + text.length)).scrollIntoView());
          view.focus();
        },
      },
    ],
  });
}
