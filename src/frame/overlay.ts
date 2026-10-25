// zdrafts' UI inside the site's page (slash menu, component handle, settings popovers), in a
// shadow root so the site's CSS and ours can't affect each other.
import { icon, type IconName } from "./icons.ts";

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #cccccc; }
.menu, .popover, .handle { pointer-events: auto; position: fixed; }
.menu { background: #252526; border: 1px solid #454545; border-radius: 6px; box-shadow: 0 8px 24px #0009; width: 300px; max-height: 340px; overflow: auto; padding: 4px; }
.group { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8b8b8b; padding: 6px 8px 2px; }
.item { display: flex; gap: 10px; align-items: center; padding: 5px 8px; border-radius: 4px; cursor: pointer; }
.item.active { background: #04395e; }
.item .icon { width: 28px; height: 28px; border-radius: 4px; display: grid; place-items: center; background: #333; color: #ddd; font: 600 12px ui-monospace, Menlo, monospace; flex-shrink: 0; }
.item .label { color: #e7e7e7; }
.item .desc { color: #9d9d9d; font-size: 12px; }
.empty { padding: 8px; color: #8b8b8b; }
.handle { display: flex; align-items: center; gap: 4px; background: #0078d4; color: #fff; border: 0; border-radius: 4px; padding: 2px 7px; font: 12px/18px ui-monospace, Menlo, monospace; cursor: pointer; box-shadow: 0 2px 8px #0006; }
.handle:hover { background: #026ec1; }
.popover { background: #252526; border: 1px solid #454545; border-radius: 6px; box-shadow: 0 8px 24px #0009; width: 320px; padding: 12px; }
.popover h3 { margin: 0 0 10px; font-size: 13px; color: #e7e7e7; font-family: ui-monospace, Menlo, monospace; }
.field { display: grid; gap: 3px; margin-bottom: 9px; }
.field label { color: #9d9d9d; font-size: 12px; display: flex; justify-content: space-between; }
.field label span { color: #6e6e6e; }
.field input[type=text] { background: #313131; border: 1px solid #3c3c3c; color: #e7e7e7; border-radius: 4px; padding: 5px 7px; font: 13px ui-monospace, Menlo, monospace; }
.field input[type=text]:focus { outline: none; border-color: #0078d4; }
.check { display: flex; gap: 6px; align-items: center; margin-bottom: 9px; color: #cccccc; }
.actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 4px; flex-wrap: wrap; }
button.btn { background: #0078d4; color: #fff; border: 0; border-radius: 4px; padding: 5px 12px; font: inherit; cursor: pointer; }
button.btn:hover { background: #026ec1; }
button.btn.secondary { background: #3a3a3a; color: #e7e7e7; }
button.btn.secondary:hover { background: #454545; }
button.btn.danger { background: #5a1d1d; color: #f2b8b5; }
.note { color: #8b8b8b; font-size: 12px; margin: -2px 0 10px; }
.error { color: #f2b8b5; font: 12px ui-monospace, Menlo, monospace; white-space: pre-wrap; margin-bottom: 8px; }
.context, .toolbar, .grip { pointer-events: auto; position: fixed; }
.context { background: #252526; border: 1px solid #454545; border-radius: 6px; box-shadow: 0 8px 24px #0009; min-width: 220px; max-height: calc(100vh - 16px); overflow: auto; overscroll-behavior: contain; padding: 4px; }
.context .section { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8b8b8b; padding: 6px 10px 2px; }
.context .sep { height: 1px; background: #454545; margin: 4px 0; }
.context button { display: flex; width: 100%; gap: 10px; align-items: center; background: none; border: 0; color: #e7e7e7; font: inherit; text-align: left; padding: 4px 10px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
.context button:hover:not(:disabled), .context button:focus-visible { background: #04395e; outline: none; }
.context button:disabled { color: #6e6e6e; cursor: default; }
.glyph { width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; color: #c5c5c5; }
.glyph svg { width: 16px; height: 16px; display: block; }
.heading-icon { font: 600 10.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; letter-spacing: -.02em; }
button:disabled .glyph { color: #5a5a5a; }
.context .keys { margin-left: auto; padding-left: 16px; color: #8b8b8b; font-size: 12px; }
.toolbar { display: flex; gap: 2px; background: #252526; border: 1px solid #454545; border-radius: 6px; box-shadow: 0 6px 18px #0009; padding: 3px; }
.toolbar button { width: 28px; height: 28px; display: grid; place-items: center; background: none; border: 0; border-radius: 4px; color: #e7e7e7; cursor: pointer; padding: 0; }
.toolbar button .glyph { color: inherit; }
.toolbar button:hover { background: #3a3d41; }
.toolbar button.on { background: #04395e; color: #fff; }
.toolbar .sep { width: 1px; background: #454545; margin: 4px 3px; }
.grip { width: 18px; height: 24px; display: grid; place-items: center; color: #8b8b8b; border-radius: 4px; cursor: grab; user-select: none; background: rgba(37, 37, 38, .6); }
.grip svg { width: 16px; height: 16px; }
.grip:hover { background: #3a3d41; color: #e7e7e7; }
.grip:active { cursor: grabbing; }
.grip[hidden] { display: none; }
`;

export interface ContextItem {
  label: string;
  icon?: IconName;
  /** Keyboard shortcut shown after the label */
  keys?: string;
  disabled?: boolean;
  run: () => void;
}

export interface ContextSection {
  title?: string;
  items: ContextItem[];
}

export interface ToolbarButton {
  icon: IconName;
  title: string;
  on?: boolean;
  /** A separator goes before this button */
  separate?: boolean;
  run: () => void;
}

export interface MenuEntry {
  group: string;
  label: string;
  description: string;
  icon: string;
}

export interface Field {
  key: string;
  label: string;
  value: string | boolean;
  hint?: string;
  options?: string[];
}

export class Overlay {
  private layer: HTMLElement;
  private menu: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private popover: HTMLElement | null = null;
  private popoverClose: (() => void) | null = null;
  private context: HTMLElement | null = null;
  private toolbar: HTMLElement | null = null;
  readonly grip: HTMLElement;
  /** Floating UI that moves with the page when it scrolls, by its position in the document */
  private pinned = new Map<HTMLElement, { left: number; top: number }>();

  constructor(private doc: Document) {
    const host = doc.createElement("zdrafts-ui");
    doc.documentElement.append(host);
    const root = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = STYLE;
    this.layer = doc.createElement("div");
    this.layer.className = "layer";
    root.append(style, this.layer);
    this.grip = doc.createElement("div");
    this.grip.className = "grip";
    this.grip.innerHTML = icon("gripper");
    this.grip.draggable = true;
    this.grip.title = "Click to select this block (then Delete removes it); drag to move it";
    this.grip.hidden = true;
    this.layer.append(this.grip);
    doc.addEventListener(
      "mousedown",
      (event) => {
        const path = event.composedPath();
        if (this.popover && !path.includes(this.popover)) this.closePopover();
        if (this.context && !path.includes(this.context)) this.hideContext();
      },
      true,
    );
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && (this.popover || this.context)) {
        event.preventDefault();
        this.closePopover();
        this.hideContext();
      }
    });
    // Menus stay beside the content they're for while the page scrolls
    doc.defaultView!.addEventListener("scroll", () => {
      const view = doc.defaultView!;
      for (const [element, at] of this.pinned) {
        if (!element.isConnected) this.pinned.delete(element);
        else {
          element.style.left = `${at.left - view.scrollX}px`;
          element.style.top = `${at.top - view.scrollY}px`;
        }
      }
    });
  }

  /** Put `element` at viewport position (left, top) and keep it there relative to the page */
  private pin(element: HTMLElement, left: number, top: number) {
    const view = this.doc.defaultView!;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    this.pinned.set(element, { left: left + view.scrollX, top: top + view.scrollY });
  }

  private place(element: HTMLElement, anchor: { left: number; top: number; bottom: number }, width: number) {
    const view = this.doc.defaultView!;
    const left = Math.max(8, Math.min(anchor.left, view.innerWidth - width - 8));
    // Below the anchor, or above it when there isn't room
    this.pin(element, left, anchor.bottom + 6);
    requestAnimationFrame(() => {
      const height = element.getBoundingClientRect().height;
      if (anchor.bottom + 6 + height > view.innerHeight - 8 && anchor.top - 6 - height > 8) {
        this.pin(element, left, anchor.top - 6 - height);
      }
    });
  }

  // --- slash menu ---

  showMenu(entries: MenuEntry[], active: number, anchor: { left: number; top: number; bottom: number }, onChoose: (index: number) => void) {
    if (!this.menu) {
      this.menu = this.doc.createElement("div");
      this.menu.className = "menu";
      this.menu.setAttribute("role", "listbox");
      this.layer.append(this.menu);
    }
    const menu = this.menu;
    menu.replaceChildren();
    if (!entries.length) {
      menu.append(Object.assign(this.doc.createElement("div"), { className: "empty", textContent: "No matches" }));
    }
    let group = "";
    entries.forEach((entry, index) => {
      if (entry.group !== group) {
        group = entry.group;
        menu.append(Object.assign(this.doc.createElement("div"), { className: "group", textContent: group }));
      }
      const item = this.doc.createElement("div");
      item.className = `item${index === active ? " active" : ""}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === active));
      item.innerHTML = `<span class="icon"></span><span><div class="label"></div><div class="desc"></div></span>`;
      item.querySelector(".icon")!.textContent = entry.icon;
      item.querySelector(".label")!.textContent = entry.label;
      item.querySelector(".desc")!.textContent = entry.description;
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        onChoose(index);
      });
      menu.append(item);
      if (index === active) requestAnimationFrame(() => item.scrollIntoView({ block: "nearest" }));
    });
    this.place(menu, anchor, 300);
  }

  hideMenu() {
    this.menu?.remove();
    this.menu = null;
  }

  // --- context menu (right click) ---

  showContext(sections: ContextSection[], x: number, y: number) {
    this.hideContext();
    this.hideToolbar();
    const menu = this.doc.createElement("div");
    menu.className = "context";
    menu.setAttribute("role", "menu");
    sections.forEach((section, i) => {
      if (i > 0) menu.append(Object.assign(this.doc.createElement("div"), { className: "sep" }));
      if (section.title) menu.append(Object.assign(this.doc.createElement("div"), { className: "section", textContent: section.title }));
      for (const item of section.items) {
        const button = this.doc.createElement("button");
        button.setAttribute("role", "menuitem");
        button.disabled = !!item.disabled;
        const glyph = Object.assign(this.doc.createElement("span"), { className: "glyph" });
        if (item.icon) glyph.innerHTML = icon(item.icon);
        button.append(glyph, Object.assign(this.doc.createElement("span"), { textContent: item.label }));
        if (item.keys) button.append(Object.assign(this.doc.createElement("span"), { className: "keys", textContent: item.keys }));
        // mousedown, so the editor keeps its selection
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          if (item.disabled) return;
          this.hideContext();
          item.run();
        });
        menu.append(button);
      }
    });
    this.layer.append(menu);
    this.context = menu;
    const view = this.doc.defaultView!;
    const rect = menu.getBoundingClientRect();
    this.pin(menu, Math.max(8, Math.min(x, view.innerWidth - rect.width - 8)), Math.max(8, Math.min(y, view.innerHeight - rect.height - 8)));
  }

  hideContext() {
    this.context?.remove();
    this.context = null;
  }

  get contextOpen(): boolean {
    return !!this.context;
  }

  // --- formatting toolbar (on a text selection) ---

  showToolbar(buttons: ToolbarButton[], anchor: { left: number; right: number; top: number; bottom: number }) {
    if (!this.toolbar) {
      this.toolbar = this.doc.createElement("div");
      this.toolbar.className = "toolbar";
      this.toolbar.setAttribute("role", "toolbar");
      this.toolbar.setAttribute("aria-label", "Formatting");
      this.layer.append(this.toolbar);
    }
    const bar = this.toolbar;
    bar.replaceChildren();
    for (const button of buttons) {
      if (button.separate) bar.append(Object.assign(this.doc.createElement("span"), { className: "sep" }));
      const element = this.doc.createElement("button");
      element.innerHTML = `<span class="glyph">${icon(button.icon)}</span>`;
      element.title = button.title;
      element.setAttribute("aria-label", button.title);
      element.setAttribute("aria-pressed", String(!!button.on));
      if (button.on) element.className = "on";
      element.addEventListener("mousedown", (event) => {
        event.preventDefault();
        button.run();
      });
      bar.append(element);
    }
    const view = this.doc.defaultView!;
    const width = bar.getBoundingClientRect().width;
    const height = bar.getBoundingClientRect().height;
    const left = Math.max(8, Math.min((anchor.left + anchor.right) / 2 - width / 2, view.innerWidth - width - 8));
    const top = anchor.top - height - 8 > 8 ? anchor.top - height - 8 : anchor.bottom + 8;
    this.pin(bar, left, top);
  }

  hideToolbar() {
    this.toolbar?.remove();
    this.toolbar = null;
  }

  // --- block grip ---

  showGrip(block: Element) {
    const rect = block.getBoundingClientRect();
    // Beside the block's first line
    const line = Math.min(rect.height, 24);
    this.grip.style.left = `${Math.max(2, rect.left - 24)}px`;
    this.grip.style.top = `${rect.top + Math.max(0, (line - 24) / 2)}px`;
    this.grip.hidden = false;
  }

  hideGrip() {
    this.grip.hidden = true;
  }

  // --- component handle ---

  showHandle(target: HTMLElement, label: string, onClick: () => void) {
    if (!this.handle) {
      this.handle = this.doc.createElement("button");
      this.handle.className = "handle";
      this.layer.append(this.handle);
    }
    const handle = this.handle;
    handle.textContent = `⚙ ${label}`;
    handle.onmousedown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
    const rect = target.getBoundingClientRect();
    handle.style.top = `${Math.max(4, rect.top - 22)}px`;
    handle.style.left = `${Math.max(4, rect.right - handle.offsetWidth)}px`;
    requestAnimationFrame(() => (handle.style.left = `${Math.max(4, rect.right - handle.offsetWidth)}px`));
  }

  hideHandle() {
    this.handle?.remove();
    this.handle = null;
  }

  isHandle(node: EventTarget | null) {
    return !!this.handle && node === this.handle;
  }

  // --- settings popover ---

  openForm(options: {
    anchor: DOMRect;
    title: string;
    note?: string;
    error?: string;
    fields: Field[];
    datalist?: string[];
    actions: { label: string; kind?: "secondary" | "danger"; run: (values: Record<string, string | boolean>) => void }[];
  }) {
    this.closePopover();
    const pop = this.doc.createElement("div");
    pop.className = "popover";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", options.title);
    const title = this.doc.createElement("h3");
    title.textContent = options.title;
    pop.append(title);
    if (options.note) pop.append(Object.assign(this.doc.createElement("div"), { className: "note", textContent: options.note }));
    if (options.error) pop.append(Object.assign(this.doc.createElement("div"), { className: "error", textContent: options.error }));
    const inputs = new Map<string, HTMLInputElement>();
    const listId = "zd-list";
    if (options.datalist?.length) {
      const list = this.doc.createElement("datalist");
      list.id = listId;
      for (const value of options.datalist) list.append(Object.assign(this.doc.createElement("option"), { value }));
      pop.append(list);
    }
    for (const field of options.fields) {
      const input = this.doc.createElement("input");
      if (typeof field.value === "boolean") {
        input.type = "checkbox";
        input.checked = field.value;
        const row = this.doc.createElement("label");
        row.className = "check";
        row.append(input, field.label);
        pop.append(row);
      } else {
        input.type = "text";
        input.value = field.value;
        input.spellcheck = false;
        if (field.key === "src" && options.datalist?.length) input.setAttribute("list", listId);
        const wrap = this.doc.createElement("div");
        wrap.className = "field";
        const label = this.doc.createElement("label");
        label.textContent = field.label;
        if (field.hint) label.append(Object.assign(this.doc.createElement("span"), { textContent: field.hint }));
        wrap.append(label, input);
        pop.append(wrap);
      }
      inputs.set(field.key, input);
    }
    const values = () => Object.fromEntries([...inputs].map(([key, input]) => [key, input.type === "checkbox" ? input.checked : input.value]));
    const actions = this.doc.createElement("div");
    actions.className = "actions";
    for (const action of options.actions) {
      const button = this.doc.createElement("button");
      button.className = `btn${action.kind ? ` ${action.kind}` : ""}`;
      button.textContent = action.label;
      button.addEventListener("click", () => {
        action.run(values());
        this.closePopover();
      });
      actions.append(button);
    }
    pop.append(actions);
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
        event.preventDefault();
        options.actions[0]?.run(values());
        this.closePopover();
      }
    });
    this.layer.append(pop);
    this.popover = pop;
    this.place(pop, options.anchor, 320);
    requestAnimationFrame(() => pop.querySelector<HTMLInputElement>("input[type=text]")?.focus());
  }

  closePopover() {
    this.popover?.remove();
    this.popover = null;
    this.popoverClose?.();
    this.popoverClose = null;
  }
}
