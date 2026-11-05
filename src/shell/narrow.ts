// Phone-sized screens. There the page itself scrolls, not the frame showing the site: mobile
// browsers hide their address and tool bars only when the page scrolls, so this gives the site the
// whole screen. The frame is made as tall as the site's page; the page scrolls instead.
import { useEffect, useState, type RefObject } from "react";
import { SANDBOX_ORIGIN } from "../origins.ts";
import type { FromPage } from "../sandbox/protocol.ts";

/** Keep in sync with the phone section of styles.css */
export const NARROW = "(max-width: 720px)";

export const isNarrow = () => matchMedia(NARROW).matches;

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow);
  useEffect(() => {
    const query = matchMedia(NARROW);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** Growing more often than this in a second means the site's height follows the frame's (100vh) */
const RUNAWAY = 12;

/**
 * Keep `frame` as tall as the page in it, for each page it loads, while `enabled`. The page is on
 * the sandbox's origin, so it reports its height itself (public/zdrafts-page.js). The frame only
 * grows while a page is shown (a page made taller to fill the screen, min-height: 100vh, would never
 * shrink back anyway); the next page starts again from the screen's height. A page whose height
 * follows the frame's (height: 100vh) would grow forever: it keeps the screen's height and scrolls
 * inside the frame, as on a wide screen.
 */
export function useFitFrame(frame: RefObject<HTMLIFrameElement | null>, enabled: boolean) {
  useEffect(() => {
    const iframe = frame.current;
    if (!enabled || !iframe) return;
    let page: string | null = null;
    let growths: number[] = [];
    let runaway = false;
    const onMessage = (event: MessageEvent<FromPage>) => {
      if (event.source !== iframe.contentWindow || event.origin !== SANDBOX_ORIGIN || event.data?.type !== "zdrafts-size") return;
      // A new page starts from the screen's height
      if (event.data.page !== page) {
        page = event.data.page;
        iframe.style.height = "";
        growths = [];
        runaway = false;
      }
      if (runaway) return;
      const height = event.data.height;
      if (height <= iframe.getBoundingClientRect().height + 1) return;
      const now = performance.now();
      growths.push(now);
      growths = growths.filter((time) => time > now - 1000);
      if (growths.length > RUNAWAY) {
        runaway = true;
        iframe.style.height = "";
        return;
      }
      iframe.style.height = `${height}px`;
    };
    addEventListener("message", onMessage);
    return () => {
      removeEventListener("message", onMessage);
      iframe.style.height = "";
    };
  }, [frame, enabled]);
}
