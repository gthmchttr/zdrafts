// Messages between the page and the Zola worker
export type WorkerRequest =
  | { type: "init"; zola: string; assetBase: string; files: [string, Uint8Array][] }
  | { type: "build"; id: number; baseUrl: string; drafts: boolean; overrides: [string, Uint8Array | null][] };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "built"; id: number; ok: boolean; stderr: string[]; files: [string, Uint8Array][]; ms: number };

export interface BuildResult {
  ok: boolean;
  stderr: string[];
  files: Map<string, Uint8Array>;
  ms: number;
}
