// Drafts: edited files, kept in IndexedDB per repository so they survive reloads.
import { createStore, del, entries, set } from "idb-keyval";

const store = typeof indexedDB === "undefined" ? undefined : createStore("zdrafts-drafts", "drafts");
const SEP = "\u0000";

export class DraftStore {
  private drafts = new Map<string, string>();

  /** `repoKey` identifies the repository and branch, e.g. "gthmchttr/gthmchttr.com@main" */
  constructor(private repoKey: string) {}

  async load(): Promise<void> {
    if (!store) return;
    for (const [key, value] of await entries<string, string>(store)) {
      const [repo, path] = key.split(SEP);
      if (repo === this.repoKey) this.drafts.set(path, value);
    }
  }

  get(path: string): string | undefined {
    return this.drafts.get(path);
  }

  paths(): string[] {
    return [...this.drafts.keys()].sort();
  }

  /** Save `text` for `path`, or drop the draft when it matches the original again */
  async save(path: string, text: string, original: string): Promise<void> {
    if (text === original) return this.discard(path);
    this.drafts.set(path, text);
    if (store) await set(`${this.repoKey}${SEP}${path}`, text, store);
  }

  async discard(path: string): Promise<void> {
    this.drafts.delete(path);
    if (store) await del(`${this.repoKey}${SEP}${path}`, store);
  }
}
