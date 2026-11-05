// Messages between the app and the sandbox's host page (src/sandbox/host.ts), which keeps the
// builds the sandbox's service worker serves.

export type ToHost =
  | WriteMessage
  | {
      /** Files the site serves that weren't downloaded (src/repo/lazy.ts): [path on the site, URL] */
      type: "lazy";
      id: number;
      files: [string, string][];
    };

export type WriteMessage = {
  type: "write";
  id: number;
  /** Cache Storage cache, served under `prefix` by public/sw.js */
  cache: string;
  prefix: string;
  /** Files to add or replace, paths relative to the site root */
  puts: [string, Uint8Array][];
  deletes: string[];
  /** Empty the cache first: a build replacing whatever an earlier session left */
  reset: boolean;
};

export type FromHost = { type: "host-ready" } | { type: "host-failed"; error: string } | { type: "written"; id: number; error?: string };

/** Messages from the sandbox's pages (public/zdrafts-page.js) to the app */
export type FromPage = { type: "zdrafts-size"; height: number; /** Different for each page loaded */ page: string } | { type: "navigate"; href: string };
