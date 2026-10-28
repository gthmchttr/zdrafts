// Drafts: edited files (text), added files (bytes, e.g. dropped images) and deleted files, kept in
// IndexedDB per repository so they survive reloads.
import { createStore, del, entries, set } from "idb-keyval";

const store = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-drafts", "drafts");
const SEP = "\u0000";

/** A file deleted (or moved away) */
export interface Deleted {
  deleted: true;
}

export type Draft = string | Uint8Array | Deleted;

export const DELETED: Deleted = { deleted: true };

export const isDeleted = (draft: Draft | undefined): draft is Deleted => typeof draft === "object" && draft !== null && !(draft instanceof Uint8Array) && draft.deleted === true;

export class DraftStore {
  private drafts = new Map<string, Draft>();

  /** `repoKey` identifies the repository and branch, e.g. "gthmchttr/gthmchttr.com@main" */
  constructor(readonly repoKey: string) {}

  async load(): Promise<void> {
    if (!store) return;
    for (const [key, value] of await entries<string, Draft>(store)) {
      const [repo, path] = key.split(SEP);
      if (repo === this.repoKey) this.drafts.set(path, value);
    }
  }

  get(path: string): Draft | undefined {
    return this.drafts.get(path);
  }

  paths(): string[] {
    return [...this.drafts.keys()].sort();
  }

  /** Save `text` for `path`, or drop the draft when it matches the original again */
  async save(path: string, text: string, original: string): Promise<void> {
    if (text === original) return this.discard(path);
    await this.put(path, text);
  }

  /** Save a new file's contents */
  async put(path: string, data: Draft): Promise<void> {
    this.drafts.set(path, data);
    if (store) await set(`${this.repoKey}${SEP}${path}`, data, store);
  }

  async discard(path: string): Promise<void> {
    this.drafts.delete(path);
    if (store) await del(`${this.repoKey}${SEP}${path}`, store);
  }
}
