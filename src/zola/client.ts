// The page's side of the Zola worker: one build at a time, in order.
import type { BuildResult, WorkerRequest, WorkerResponse } from "./protocol.ts";

export class ZolaClient {
  private worker: Worker;
  private ready: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, (result: BuildResult) => void>();
  private reads = new Map<number, (data: Uint8Array | undefined) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * `cacheKey` names the repository, so resized images are kept for it between sessions. Files
   * `kept` says no to are handed to the worker and removed from `files` (read them with read());
   * the others are copied.
   */
  constructor(zola: string, files: Map<string, Uint8Array>, cacheKey?: string, kept: (path: string) => boolean = () => true) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === "ready") resolve();
        else if (data.type === "failed") reject(new Error(`Couldn't load Zola ${zola}: ${data.error}`));
        else if (data.type === "file") {
          this.reads.get(data.id)?.(data.data ?? undefined);
          this.reads.delete(data.id);
        } else if (data.type === "built") {
          const { type: _, id, files, ...result } = data;
          this.pending.get(id)?.({ ...result, files: new Map(files) });
          this.pending.delete(data.id);
        }
      };
      this.worker.onerror = (event) => reject(new Error(event.message));
    });
    // A buffer is handed over only if no file kept here uses it (symbolic links share theirs)
    const keptBuffers = new Set([...files].filter(([path]) => kept(path)).map(([, data]) => data.buffer));
    const transfer = new Set<ArrayBuffer>();
    const sent = [...files].map(([path, data]): [string, Uint8Array] => {
      if (kept(path) || keptBuffers.has(data.buffer)) return [path, data.slice()];
      files.delete(path);
      transfer.add(data.buffer as ArrayBuffer);
      return [path, data];
    });
    const message: WorkerRequest = { type: "init", zola, assetBase: import.meta.env.BASE_URL, files: sent, cacheKey };
    this.worker.postMessage(message, [...transfer]);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /**
   * Build the repository's files with `overrides` applied (null deletes a file), draft pages
   * included unless `drafts` is false. With a `target`, the result says what changed since the last
   * build for it.
   */
  build(
    overrides: Map<string, Uint8Array | null>,
    baseUrl: string,
    { drafts = true, target, complete }: { drafts?: boolean; target?: string; complete?: boolean } = {},
  ): Promise<BuildResult> {
    const run = async () => {
      await this.ready;
      const id = this.nextId++;
      return new Promise<BuildResult>((resolve) => {
        this.pending.set(id, resolve);
        const message: WorkerRequest = { type: "build", id, baseUrl, drafts, overrides: [...overrides], target, complete };
        this.worker.postMessage(message);
      });
    };
    const result = this.queue.then(run, run);
    this.queue = result;
    return result;
  }

  /** A repository file handed to the worker (not kept here) */
  read(path: string): Promise<Uint8Array | undefined> {
    return this.ready.then(
      () =>
        new Promise((resolve) => {
          const id = this.nextId++;
          this.reads.set(id, resolve);
          const message: WorkerRequest = { type: "read", id, path };
          this.worker.postMessage(message);
        }),
    );
  }

  /** The repository's files changed (a commit, a file downloaded later); null deletes one. Applies to the builds after it */
  update(files: Map<string, Uint8Array | null>) {
    const message: WorkerRequest = { type: "update", files: [...files].map(([p, d]) => [p, d && d.slice()]) };
    this.worker.postMessage(message);
  }

  dispose() {
    this.worker.terminate();
  }
}
