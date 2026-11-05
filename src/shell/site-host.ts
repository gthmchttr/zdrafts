// The app's side of the sandbox (src/origins.ts): a hidden frame on the sandbox's origin
// (src/sandbox/host.ts) that keeps each build in its Cache Storage, where the sandbox's service
// worker (public/sw.js) serves it: the editing build under /site/, the view build under /view/.
import { SANDBOX_ORIGIN } from "../origins.ts";
import type { FromHost, ToHost } from "../sandbox/protocol.ts";

export const SITE_PREFIX = "/site";
export const VIEW_PREFIX = "/view";

/** A page of the sandbox: SANDBOX_ORIGIN + "/site/posts/" */
export const sandboxUrl = (path: string) => `${SANDBOX_ORIGIN}${path}`;

let host: Promise<Window> | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

/** Load the host frame once, and wait until its service worker is ready */
export function connectSandbox(): Promise<Window> {
  host ??= new Promise<Window>((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.title = "zdrafts sandbox";
    frame.src = `${SANDBOX_ORIGIN}${import.meta.env.BASE_URL}host.html`;
    addEventListener("message", (event: MessageEvent<FromHost>) => {
      if (event.origin !== SANDBOX_ORIGIN || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (message.type === "host-ready") resolve(frame.contentWindow!);
      else if (message.type === "host-failed") reject(new Error(message.error));
      else if (message.type === "written") {
        const waiting = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) waiting?.reject(new Error(message.error));
        else waiting?.resolve();
      }
    });
    document.body.append(frame);
  });
  host.catch(() => (host = null));
  return host;
}

function send(message: ToHost, transfer: Transferable[] = []): Promise<void> {
  return connectSandbox().then(
    (window) =>
      new Promise<void>((resolve, reject) => {
        pending.set(message.id, { resolve, reject });
        window.postMessage(message, SANDBOX_ORIGIN, transfer);
      }),
  );
}

/** Tell the sandbox which files the site serves weren't downloaded: [path on the site, URL] */
export function sendNotDownloaded(files: [string, string][]): Promise<void> {
  return send({ type: "lazy", id: nextId++, files });
}

/**
 * One build's place in the sandbox: a cache and the prefix it's served under. Writes are applied
 * in order; the files' buffers are handed over to the sandbox (not copied), so they can't be used
 * here afterwards.
 */
export class SiteTarget {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly cache: string,
    readonly prefix: string,
  ) {}

  write(puts: Map<string, Uint8Array>, deletes: string[] = [], reset = false): Promise<void> {
    const run = () => {
      const message: ToHost = { type: "write", id: nextId++, cache: this.cache, prefix: this.prefix, puts: [...puts], deletes, reset };
      return send(message, [...new Set([...puts.values()].map((data) => data.buffer as ArrayBuffer))]);
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }
}
