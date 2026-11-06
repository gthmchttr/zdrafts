// Probing components: render each component call the open page uses, with a placeholder where
// its editable part goes, to get the theme's real markup around it.
//
//   block  {% <warning title="x"> %}<!--zdrafts:slot-->{% </warning> %}
//          → the wrapper HTML with the slot comment where the body goes (if it survives)
//   text   {{ <color text="zdrafts-slot-3" color="blue" /> }}
//          → the HTML with that text where the editable text goes
//   atom   {{ <img src="…" /> }}   → just the HTML
//   code   a fenced code block (name: its language, args: its code) → Zola's highlighted <pre>
//   source any of the page's source (args), as it's written → the HTML Zola renders for it: a
//          component whose body the theme transforms (name "block"), Tera in a sentence ("inline")
import { inlineTag, openTag } from "../markdown/remark-zola.ts";
import { setStringAttr } from "../markdown/tera.ts";
import { SLOT, SLOT_MARKER } from "./markers.ts";

export type ProbeKind = "block" | "text" | "atom" | "code" | "source";

export interface ProbeCall {
  kind: ProbeKind;
  name: string;
  args: string;
  /** "code": the block is in {% raw %} in the page, so Tera leaves it as it is */
  raw?: boolean;
}

export interface ProbeResult {
  /** Rendered HTML; for "block" and "text" calls with `slot` true, it contains the slot marker */
  html: string;
  /** Whether the placeholder survived, so that part can be edited in place */
  slot: boolean;
  /** For "text" calls: the placeholder text standing for the editable text */
  marker?: string;
  error?: string;
}


export const textSlot = (n: number) => `zdrafts-slot-${n}`;

export const probeKey = (call: ProbeCall) => `${call.kind}\u0000${call.name}\u0000${call.args}${call.raw ? "\u0000raw" : ""}`;

/** The probe page's Markdown: `frontMatter` sets how it renders (see probecontext.ts) */
export function probePage(calls: ProbeCall[], frontMatter = '+++\ntitle = "zdrafts probe"\n+++\n'): string {
  const parts = calls.map((call, n) => {
    if (call.kind === "code") {
      // A fence longer than any run of backticks in the code
      const longest = Math.max(2, ...[...call.args.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = "`".repeat(longest + 1);
      // Zola renders a page's Tera before its Markdown, code included: a block the page has in
      // {% raw %} is highlighted as it's written; one it hasn't, after Tera
      const code = `${fence}${call.name}\n${call.args}\n${fence}`;
      const raw = call.raw && !call.args.includes("endraw") ? `{% raw %}\n${code}\n{% endraw %}` : code;
      return `<div data-zdrafts-probe="${n}">\n\n${raw}\n\n</div>`;
    }
    if (call.kind === "block") {
      return `<div data-zdrafts-probe="${n}">\n\n${openTag(call.name, call.args)}${SLOT_MARKER}{% </${call.name}> %}\n\n</div>`;
    }
    if (call.kind === "source") {
      // Inline: in the HTML block, so Markdown doesn't make a paragraph of it
      return call.name === "inline" ? `<div data-zdrafts-probe="${n}">${call.args}</div>` : `<div data-zdrafts-probe="${n}">\n\n${call.args}\n\n</div>`;
    }
    const args = call.kind === "text" ? setStringAttr(call.args, "text", textSlot(n)) : call.args;
    return `<div data-zdrafts-probe="${n}">${inlineTag(call.name, args)}</div>`;
  });
  // A heading, for templates that expect a table of contents
  return `${frontMatter}\n# zdrafts probe\n\n${parts.join("\n\n")}\n`;
}

/** Read each call's result out of the probe page's HTML (needs a DOM: runs in the page) */
export function parseProbe(html: string, calls: ProbeCall[]): ProbeResult[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return calls.map((call, n) => {
    const element = doc.querySelector(`[data-zdrafts-probe="${n}"]`);
    if (!element) return { html: "", slot: false, error: "The theme didn't render this component" };
    const inner = element.innerHTML.trim();
    if (call.kind === "block") return { html: inner, slot: !!element.querySelector(SLOT) };
    if (call.kind === "text") return { html: inner, slot: inner.includes(textSlot(n)), marker: textSlot(n) };
    return { html: inner, slot: false };
  });
}
