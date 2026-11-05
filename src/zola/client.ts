// The page's side of the Zola worker: one build at a time, in order.
import type { BuildResult, WorkerRequest, WorkerResponse } from "./protocol.ts";

export class ZolaClient {
  private worker: Worker;
  private ready: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, (result: BuildResult) => void>();
  private queue: Promise<unknown> = Promise.resolve();

  /** `cacheKey` names the repository, so resized images are kept for it between sessions */
  constructor(zola: string, files: Map<string, Uint8Array>, cacheKey?: string) {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.ready = new Promise((resolve, reject) => {
      this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
        if (data.type === "ready") resolve();
        else if (data.type === "failed") reject(new Error(`Couldn't load Zola ${zola}: ${data.error}`));
        else if (data.type === "built") {
          const { type: _, id, files, ...result } = data;
          this.pending.get(id)?.({ ...result, files: new Map(files) });
          this.pending.delete(data.id);
        }
      };
      this.worker.onerror = (event) => reject(new Error(event.message));
    });
    // Copies: the repository's files stay usable on this side
    const message: WorkerRequest = { type: "init", zola, assetBase: import.meta.env.BASE_URL, files: [...files].map(([p, d]) => [p, d.slice()]), cacheKey };
    this.worker.postMessage(message);
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

  /** The repository's files changed (a commit); null deletes one. Applies to the builds after it */
  update(files: Map<string, Uint8Array | null>) {
    const message: WorkerRequest = { type: "update", files: [...files].map(([p, d]) => [p, d && d.slice()]) };
    this.worker.postMessage(message);
  }

  dispose() {
    this.worker.terminate();
  }
}
