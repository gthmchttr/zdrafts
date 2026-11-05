// Drafts: edited files (text), added files (bytes, e.g. dropped images) and deleted files, kept in
// IndexedDB per repository so they survive reloads.
import { createStore, del, entries, set } from "idb-keyval";

const store = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-drafts", "drafts");

let persisting = false;

/**
 * Ask the browser to keep this site's storage (drafts, sites made here) instead of clearing it when
 * space runs low or, in Safari, after a week without a visit. Asked once there's something to lose:
 * Firefox asks the user.
 */
export function keepStorage() {
  if (persisting || typeof navigator === "undefined" || !navigator.storage?.persist) return;
  persisting = true;
  void navigator.storage.persisted().then((already) => already || navigator.storage.persist()).catch(() => {});
}
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
  /** Goes up with every change, to tell whether anything changed since */
  revision = 0;
  /** Called after every change */
  onChange: (() => void) | null = null;

  private changed() {
    this.revision++;
    if (this.drafts.size) keepStorage();
    this.onChange?.();
  }

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
    this.changed();
    if (store) await set(`${this.repoKey}${SEP}${path}`, data, store);
  }

  async discard(path: string): Promise<void> {
    if (!this.drafts.delete(path)) return;
    this.changed();
    if (store) await del(`${this.repoKey}${SEP}${path}`, store);
  }
}
