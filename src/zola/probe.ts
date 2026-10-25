// Probing components: render each component call the open page uses, with a placeholder where
// its editable part goes, to get the theme's real markup around it.
//
//   block  {% <warning title="x"> %}<!--zdrafts:slot-->{% </warning> %}
//          → the wrapper HTML with the slot comment where the body goes (if it survives)
//   text   {{ <color text="zdrafts-slot-3" color="blue" /> }}
//          → the HTML with that text where the editable text goes
//   atom   {{ <img src="…" /> }}   → just the HTML
import { inlineTag, openTag } from "../markdown/remark-zola.ts";
import { setStringAttr } from "../markdown/tera.ts";

export type ProbeKind = "block" | "text" | "atom";

export interface ProbeCall {
  kind: ProbeKind;
  name: string;
  args: string;
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

export const PROBE_CONTENT = "content/__zdrafts__/probe.md";
export const SLOT_COMMENT = "zdrafts:slot";
export const textSlot = (n: number) => `zdrafts-slot-${n}`;

export const probeKey = (call: ProbeCall) => `${call.kind}\u0000${call.name}\u0000${call.args}`;

export function probePage(calls: ProbeCall[]): string {
  const parts = calls.map((call, n) => {
    if (call.kind === "block") {
      return `<div data-zdrafts-probe="${n}">\n\n${openTag(call.name, call.args)}<!--${SLOT_COMMENT}-->{% </${call.name}> %}\n\n</div>`;
    }
    const args = call.kind === "text" ? setStringAttr(call.args, "text", textSlot(n)) : call.args;
    return `<div data-zdrafts-probe="${n}">${inlineTag(call.name, args)}</div>`;
  });
  return `+++\ntitle = "zdrafts probe"\n+++\n\n${parts.join("\n\n")}\n`;
}

/** Read each call's result out of the probe page's HTML (needs a DOM: runs in the page) */
export function parseProbe(html: string, calls: ProbeCall[]): ProbeResult[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return calls.map((call, n) => {
    const element = doc.querySelector(`[data-zdrafts-probe="${n}"]`);
    if (!element) return { html: "", slot: false, error: "The theme didn't render this component" };
    const inner = element.innerHTML.trim();
    if (call.kind === "block") return { html: inner, slot: inner.includes(`<!--${SLOT_COMMENT}-->`) };
    if (call.kind === "text") return { html: inner, slot: inner.includes(textSlot(n)), marker: textSlot(n) };
    return { html: inner, slot: false };
  });
}
