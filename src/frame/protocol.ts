// Messages between the shell (zdrafts' UI) and the editor running inside the site's page
import type { ComponentInfo } from "../zola/components.ts";
import type { ProbeCall, ProbeResult } from "../zola/probe.ts";

export interface ThemeInfo {
  editCss: string;
  hiddenComponents: string[];
  componentHints: Record<string, { label?: string; description?: string; icon?: string; keywords?: string[] }>;
}

export type FrameToShell =
  | { type: "frame-ready"; path: string }
  | { type: "doc-change"; path: string; body: string }
  | { type: "probe"; id: number; calls: ProbeCall[] }
  | { type: "navigate"; href: string }
  /** A dropped or pasted file to add to the site */
  | { type: "add-asset"; id: number; name: string; data: ArrayBuffer };

export type ShellToFrame =
  | {
      type: "doc";
      path: string;
      body: string;
      components: ComponentInfo[];
      theme: ThemeInfo;
      /** Image files under static/, for the image picker */
      staticImages: string[];
      siteUrl: string;
    }
  | { type: "probe-result"; id: number; results: [string, ProbeResult][] }
  /** The added file's URL on the site ("/images/a.png") */
  | { type: "asset-added"; id: number; src?: string; error?: string };
