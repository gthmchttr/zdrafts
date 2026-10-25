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
  | { type: "navigate"; href: string };

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
  | { type: "probe-result"; id: number; results: [string, ProbeResult][] };
