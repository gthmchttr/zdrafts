// The editor's side of component probing: batches requests to the shell, which builds them with
// Zola (src/zola/probe.ts), and notifies node views when results arrive.
import { probeKey, type ProbeCall, type ProbeResult } from "../zola/probe.ts";
import type { FrameToShell, ShellToFrame } from "./protocol.ts";

export class Probes {
  private results = new Map<string, ProbeResult>();
  private requested = new Set<string>();
  private queue = new Map<string, ProbeCall>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 1;
  private listeners = new Set<() => void>();
  /** Bumped whenever results arrive, so views know to look again */
  version = 0;

  constructor(private post: (message: FrameToShell) => void) {}

  get(call: ProbeCall): ProbeResult | undefined {
    const key = probeKey(call);
    const result = this.results.get(key);
    if (!result && !this.requested.has(key)) this.request(call);
    return result;
  }

  /** A result if there is one, without asking for it */
  peek(call: ProbeCall): ProbeResult | undefined {
    return this.results.get(probeKey(call));
  }

  request(call: ProbeCall) {
    const key = probeKey(call);
    if (this.requested.has(key)) return;
    this.requested.add(key);
    this.queue.set(key, call);
    clearTimeout(this.timer);
    // Batched: one Zola build for every component a page (or an edit) needs
    this.timer = setTimeout(() => this.flush(), 120);
  }

  private flush() {
    const calls = [...this.queue.values()];
    this.queue.clear();
    if (calls.length) this.post({ type: "probe", id: this.nextId++, calls });
  }

  receive(message: Extract<ShellToFrame, { type: "probe-result" }>) {
    for (const [key, result] of message.results) this.results.set(key, result);
    this.version++;
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
