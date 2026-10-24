// Builds the site with zola.wasm, off the main thread.
//
// Holds the repository's files; each build applies overrides (drafts, marker bodies, the probe
// page) on top. Processed images from the last build are fed back as static/processed_images/,
// which Zola reuses instead of resizing them again.
/// <reference lib="webworker" />
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
const processed = new Map<string, Uint8Array>();

const post = (message: WorkerResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(message, transfer);

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === "init") {
    base = new Map(data.files);
    processed.clear();
    const root = `${data.assetBase}zola/${data.zola}/`;
    zola = import(/* @vite-ignore */ `${root}zola-wasi.js`).then((module) => module.loadZola(new URL(`${root}zola.wasm`, self.location.origin)));
    try {
      await zola;
      post({ type: "ready" });
    } catch (error) {
      post({ type: "failed", error: String(error) });
    }
    return;
  }
  if (data.type === "build") {
    const files = new Map(base);
    for (const [path, value] of data.overrides) {
      if (value === null) files.delete(path);
      else files.set(path, value);
    }
    for (const [path, value] of processed) if (!files.has(path)) files.set(path, value);
    const started = performance.now();
    // Draft pages (draft = true) are what people edit most, so they're always built
    const result = await (await zola!).build({ files, baseUrl: data.baseUrl, drafts: true });
    if (result.ok) {
      for (const [path, value] of result.files) {
        // A copy: the output buffers are transferred to the page below
        if (path.startsWith("processed_images/")) processed.set(`static/${path}`, value.slice());
      }
    }
    const entries = [...result.files];
    post(
      { type: "built", id: data.id, ok: result.ok, stderr: result.stderr, files: entries, ms: Math.round(performance.now() - started) },
      [...new Set(entries.map(([, bytes]) => bytes.buffer as ArrayBuffer))],
    );
  }
};
