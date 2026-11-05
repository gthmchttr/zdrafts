// Messages between the page and the Zola worker
export type WorkerRequest =
  | {
      type: "init";
      zola: string;
      assetBase: string;
      files: [string, Uint8Array][];
      /** Names the repository, so the images Zola resizes are kept for it between sessions */
      cacheKey?: string;
    }
  /** The repository's files changed (a commit): null deletes one */
  | { type: "update"; files: [string, Uint8Array | null][] }
  | {
      type: "build";
      id: number;
      baseUrl: string;
      drafts: boolean;
      overrides: [string, Uint8Array | null][];
      /** Where the output is published ("site", "view"): what changed is reported against the last build published there */
      target?: string;
      /** Every page with its content (not the editing build): resized images it didn't use can go */
      complete?: boolean;
    };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | ({ type: "built"; id: number; files: [string, Uint8Array][] } & Omit<BuildResult, "files">);

export interface BuildResult {
  ok: boolean;
  stderr: string[];
  files: Map<string, Uint8Array>;
  ms: number;
  /** With a target: output files that differ from the target's last build, and ones no longer there */
  changed: string[];
  removed: string[];
  /** The target's first build here: whatever is published there is from an earlier session */
  fresh: boolean;
}
