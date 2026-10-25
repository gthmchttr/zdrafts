// Writes a build's output into Cache Storage, where public/sw.js serves it under /site/.
// Only files that changed since the last write are touched, so rebuilding is cheap.

const CACHE = "zdrafts-site";
export const SITE_PREFIX = "/site";

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

/** A cheap fingerprint to tell whether a file changed (FNV-1a over the bytes, plus length) */
function fingerprint(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) hash = Math.imul(hash ^ data[i], 0x01000193);
  return `${data.length}:${(hash >>> 0).toString(16)}`;
}

export class SiteCache {
  private written = new Map<string, string>();

  /** Make the cache hold exactly `files` (paths relative to the site root) */
  /**
   * Publish a build's output. With `complete` false, `files` are added to what's published (a new
   * image, before the next build) instead of replacing it.
   */
  async write(files: Map<string, Uint8Array>, complete = true): Promise<void> {
    if (this.written.size === 0 && complete) await caches.delete(CACHE);
    const cache = await caches.open(CACHE);
    const writes: Promise<void>[] = [];
    for (const [path, data] of files) {
      const print = fingerprint(data);
      if (this.written.get(path) === print) continue;
      this.written.set(path, print);
      const body = new Blob([data as BlobPart], { type: contentType(path) });
      writes.push(cache.put(`${SITE_PREFIX}/${path}`, new Response(body, { headers: { "content-type": contentType(path) } })));
    }
    for (const path of complete ? [...this.written.keys()] : []) {
      if (!files.has(path)) {
        this.written.delete(path);
        writes.push(cache.delete(`${SITE_PREFIX}/${path}`).then(() => {}));
      }
    }
    await Promise.all(writes);
  }
}

/** Register public/sw.js and wait until it controls this page */
export async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) throw new Error("This browser doesn't support service workers, which zdrafts needs for the preview.");
  // The frame editor is a separate entry: Vite serves it from source in development
  const frame = import.meta.env.DEV ? "/src/frame/main.ts" : `${import.meta.env.BASE_URL}frame.js`;
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js?frame=${encodeURIComponent(frame)}`, { scope: "/" });
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }));
}
