// The sandbox's host page (host.html), loaded by the app in a hidden frame. It registers the
// sandbox's service worker and writes the builds the app sends into Cache Storage, where the
// service worker serves them (/site/, /view/). Only the app may write (src/origins.ts).
import { APP_ORIGIN, SANDBOX_ORIGIN } from "../origins.ts";
import type { FromHost, ToHost } from "./protocol.ts";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
};

export function contentType(path: string): string {
  return TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
}

const reply = (message: FromHost) => parent.postMessage(message, APP_ORIGIN);

async function write({ cache: name, prefix, puts, deletes, reset }: ToHost) {
  if (reset) await caches.delete(name);
  const cache = await caches.open(name);
  await Promise.all([
    ...puts.map(([path, data]) => {
      const type = contentType(path);
      return cache.put(`${prefix}/${path}`, new Response(new Blob([data as BlobPart], { type }), { headers: { "content-type": type } }));
    }),
    ...deletes.map((path) => cache.delete(`${prefix}/${path}`)),
  ]);
}

async function start() {
  if (location.origin !== SANDBOX_ORIGIN || parent === window) return;
  addEventListener("message", (event: MessageEvent<ToHost>) => {
    if (event.origin !== APP_ORIGIN || event.source !== parent || event.data?.type !== "write") return;
    const { id } = event.data;
    write(event.data).then(
      () => reply({ type: "written", id }),
      (error) => reply({ type: "written", id, error: String(error) }),
    );
  });
  try {
    if (!("serviceWorker" in navigator)) throw new Error("This browser doesn't support service workers, which zdrafts needs for the preview.");
    // The editor frame is a separate entry: Vite serves it from source in development
    const frame = import.meta.env.DEV ? "/src/frame/main.ts" : `${import.meta.env.BASE_URL}frame.js`;
    const query = new URLSearchParams({ frame, app: APP_ORIGIN });
    await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?${query}`, { scope: "/" });
    await navigator.serviceWorker.ready;
    reply({ type: "host-ready" });
  } catch (error) {
    reply({ type: "host-failed", error: error instanceof Error ? error.message : String(error) });
  }
}

void start();
