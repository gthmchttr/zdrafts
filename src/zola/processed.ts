// Images Zola resized (resize_image: its processed_images/ output), kept between builds and, in
// IndexedDB, between sessions: fed back as static/processed_images/, Zola reuses them instead of
// resizing again, which is most of a full build's time.
//
// Zola names a processed image after its source's path and the operation, not its contents, and
// redoes it only when the source is newer, which it can't tell here (files have no times). So each
// one is kept with a fingerprint of the images it could have come from (those with the same file
// stem) and dropped once they change.
import { createStore, delMany, getMany, keys, setMany, type UseStore } from "idb-keyval";
import { fingerprint } from "./fingerprint.ts";

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i;
const DIR = "processed_images/";

/** "blog_a_record.ee0b62b036d1a821.webp" → "blog_a_record" */
export const processedStem = (name: string) => name.replace(/\.[0-9a-f]{16}\.\w+$/, "");

const sourceStem = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

interface Entry {
  data: Uint8Array;
  /** Fingerprint of the source images (processedSources) when it was made */
  source: string;
}

export class ProcessedImages {
  private entries = new Map<string, Entry>();
  /** Fingerprints of input files, by buffer: inputs rarely change between builds */
  private prints = new WeakMap<Uint8Array, string>();
  private store: UseStore | undefined;

  /** `key` names the repository whose images are kept (no key: kept for this session only) */
  constructor(private key?: string) {
    if (key && typeof indexedDB !== "undefined") this.store = createStore("zdrafts-processed", "images");
  }

  private storeKey = (name: string) => `${this.key}\u0000${name}`;

  async load(): Promise<void> {
    if (!this.store) return;
    try {
      const prefix = this.storeKey("");
      const names = (await keys<string>(this.store)).filter((key) => key.startsWith(prefix));
      const values = await getMany<Entry | undefined>(names, this.store);
      names.forEach((key, i) => values[i] && this.entries.set(key.slice(prefix.length), values[i]));
    } catch {
      // Storage unavailable: images are resized again
    }
  }

  /** For each file stem, a fingerprint of the input images with that stem */
  sources(files: Map<string, Uint8Array>): Map<string, string> {
    const byStem = new Map<string, string[]>();
    for (const [path, data] of files) {
      if (!IMAGE.test(path) || path.includes(DIR)) continue;
      let print = this.prints.get(data);
      if (!print) this.prints.set(data, (print = fingerprint(data)));
      const stem = sourceStem(path);
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem)!.push(`${path}=${print}`);
    }
    return new Map([...byStem].map(([stem, list]) => [stem, list.sort().join("|")]));
  }

  /** The images still good for these sources, as input files (static/processed_images/…); stale ones are dropped */
  inputs(sources: Map<string, string>): Map<string, Uint8Array> {
    const stale: string[] = [];
    for (const [name, entry] of this.entries) {
      if ((sources.get(processedStem(name)) ?? "") !== entry.source) stale.push(name);
    }
    this.forget(stale);
    return new Map([...this.entries].map(([name, entry]) => [`static/${DIR}${name}`, entry.data]));
  }

  /**
   * Keep the images a build made. After a `complete` build (every page with its content), the ones
   * it didn't use aren't needed any more.
   */
  record(output: Map<string, Uint8Array>, sources: Map<string, string>, complete: boolean) {
    const fresh: [string, Entry][] = [];
    const used = new Set<string>();
    for (const [path, data] of output) {
      if (!path.startsWith(DIR)) continue;
      const name = path.slice(DIR.length);
      used.add(name);
      if (this.entries.has(name)) continue;
      // A copy: the output's buffers are handed to the page
      const entry = { data: data.slice(), source: sources.get(processedStem(name)) ?? "" };
      this.entries.set(name, entry);
      fresh.push([name, entry]);
    }
    if (complete) this.forget([...this.entries.keys()].filter((name) => !used.has(name)));
    if (this.store && fresh.length) void setMany(fresh.map(([name, entry]) => [this.storeKey(name), entry]), this.store).catch(() => {});
  }

  private forget(names: string[]) {
    if (!names.length) return;
    for (const name of names) this.entries.delete(name);
    if (this.store) void delMany(names.map(this.storeKey), this.store).catch(() => {});
  }
}
