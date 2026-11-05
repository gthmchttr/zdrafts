// Builds the site with zola.wasm, off the main thread.
//
// Holds the repository's files; each build applies overrides (drafts, marker bodies, the probe
// page) on top. Images Zola resized are fed back to it (src/zola/processed.ts).
/// <reference lib="webworker" />
import { fingerprint } from "./fingerprint.ts";
import { ProcessedImages } from "./processed.ts";
import type { WorkerRequest, WorkerResponse } from "./protocol.ts";

interface Zola {
  build(options: { files: Map<string, Uint8Array>; baseUrl?: string; drafts?: boolean }): Promise<{
    ok: boolean;
    exitCode: number;
    files: Map<string, Uint8Array>;
    stderr: string[];
  }>;
}

let zola: Promise<Zola> | null = null;
let base = new Map<string, Uint8Array>();
let processed = new ProcessedImages();
/** Each target's last published output: path → fingerprint */
const published = new Map<string, Map<string, string>>();

/** What changed in `files` since the target's last build (and remember this one) */
function diff(target: string | undefined, files: Map<string, Uint8Array>) {
  if (!target) return { changed: [...files.keys()], removed: [], fresh: false };
  const before = published.get(target);
  const now = new Map([...files].map(([path, data]) => [path, fingerprint(data)]));
  published.set(target, now);
  return {
    changed: [...now].filter(([path, print]) => before?.get(path) !== print).map(([path]) => path),
    removed: before ? [...before.keys()].filter((path) => !now.has(path)) : [],
    fresh: !before,
  };
}

const post = (message: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === "init") {
    base = new Map(data.files);
    processed = new ProcessedImages(data.cacheKey);
    const root = `${data.assetBase}zola/${data.zola}/`;
    zola = import(/* @vite-ignore */ `${root}zola-wasi.js`).then((module) => module.loadZola(new URL(`${root}zola.wasm`, self.location.origin)));
    try {
      await Promise.all([zola, processed.load()]);
      post({ type: "ready" });
    } catch (error) {
      post({ type: "failed", error: String(error) });
    }
    return;
  }
  if (data.type === "read") {
    const file = base.get(data.path);
    post({ type: "file", id: data.id, data: file ? file.slice() : null });
    return;
  }
  if (data.type === "update") {
    for (const [path, value] of data.files) {
      if (value === null) base.delete(path);
      else base.set(path, value);
    }
    return;
  }
  if (data.type === "build") {
    const files = new Map(base);
    for (const [path, value] of data.overrides) {
      if (value === null) files.delete(path);
      else files.set(path, value);
    }
    const sources = processed.sources(files);
    for (const [path, value] of processed.inputs(sources)) if (!files.has(path)) files.set(path, value);
    const started = performance.now();
    // Draft pages (draft = true) are what people edit most, so editing builds always include them
    const result = await (await zola!).build({ files, baseUrl: data.baseUrl, drafts: data.drafts });
    if (result.ok) processed.record(result.files, sources, !!data.complete);
    const entries = [...result.files];
    const changes = result.ok ? diff(data.target, result.files) : { changed: [], removed: [], fresh: false };
    post(
      { type: "built", id: data.id, ok: result.ok, stderr: result.stderr, files: entries, ms: Math.round(performance.now() - started), ...changes },
      [...new Set(entries.map(([, bytes]) => bytes.buffer as ArrayBuffer))],
    );
  }
};
