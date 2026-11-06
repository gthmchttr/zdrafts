// Runs inside the site's page, in the sandbox (injected by public/sw.js): replaces the page's content marker with
// the editor, so everything around it is the theme's real markup and CSS.
import proseMirrorCss from "@milkdown/kit/prose/view/style/prosemirror.css?inline";
import tablesCss from "@milkdown/kit/prose/tables/style/tables.css?inline";
import { Assets } from "./assets.ts";
import { createEditor } from "./editor.ts";
import { Probes } from "./probes.ts";
import { APP_ORIGIN } from "../origins.ts";
import { END, START } from "../zola/markers.ts";
import type { AnchorTemplate } from "../markdown/zola-render.ts";
import { anchorTemplate, headingTextWithoutAnchor } from "./anchors.ts";
import type { FrameToShell, ShellToFrame } from "./protocol.ts";
import editorCss from "./frame.css?inline";

const path = document.querySelector<HTMLMetaElement>('meta[name="zdrafts-edit"]')?.content ?? "";
// The app is on another origin (src/origins.ts): only it is talked to, and listened to
const post = (message: FrameToShell) => window.parent.postMessage(message, APP_ORIGIN);

function addStyle(css: string) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
}

/**
 * Swap the stand-in content Zola rendered (see src/zola/chrome.ts) for the editor's root: the
 * start marker, the headings after it and the end marker (src/zola/markers.ts).
 */
function mountPoint(): { root: HTMLElement; headings: { text: string; id: string }[]; anchor: AnchorTemplate | null } | null {
  const marker = (tag: string) => [...document.querySelectorAll(tag)].find((element) => element.getAttribute("data-zdrafts-path") === path);
  const start = marker(START);
  if (!start) return null;
  const end = marker(END);
  const root = document.createElement("div");
  root.className = "zd-root";
  // The end marker is a sibling, unless the theme moved content around; then only the markers go
  const between: ChildNode[] = [];
  if (end && end.parentNode === start.parentNode) {
    for (let next = start.nextSibling; next && next !== end; next = next.nextSibling) between.push(next);
  }
  // The headings Zola rendered in the stand-in content: the ids it gave them, and its anchor links
  const rendered = between.filter((child): child is HTMLElement => child instanceof HTMLElement && /^H[1-6]$/.test(child.tagName));
  const withAnchor = [...rendered].sort((a, b) => b.id.length - a.id.length).map(anchorTemplate).find(Boolean) ?? null;
  const headings = rendered.map((heading) => ({ text: headingTextWithoutAnchor(heading, withAnchor), id: heading.id }));
  between.forEach((child) => child.remove());
  end?.remove();
  start.replaceWith(root);
  return { root, headings, anchor: withAnchor };
}

async function main() {
  addStyle(proseMirrorCss);
  addStyle(tablesCss);
  addStyle(editorCss);
  const mount = mountPoint();
  const root = mount?.root;
  if (!mount || !root) {
    document.body.insertAdjacentHTML("afterbegin", '<p style="font:14px system-ui;padding:1rem;background:#fee">zdrafts: this page\'s content area wasn\'t found.</p>');
    return;
  }

  // Links in the page's chrome open that page in zdrafts instead of navigating the frame
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!link || root.contains(link) || event.defaultPrevented) return;
      if (link.pathname === location.pathname && link.hash) return; // within the page
      event.preventDefault();
      post({ type: "navigate", href: link.href });
    },
    true,
  );

  const probes = new Probes(post);
  const assets = new Assets(post);
  let started = false;
  window.addEventListener("message", (event: MessageEvent<ShellToFrame>) => {
    if (event.origin !== APP_ORIGIN || event.source !== window.parent) return;
    const message = event.data;
    if (message.type === "probe-result") probes.receive(message);
    else if (message.type === "asset-added") assets.receive(message);
    else if (message.type === "doc" && message.path === path && !started) {
      started = true;
      addStyle(message.theme.editCss);
      createEditor(root, message, { headings: mount.headings, anchor: mount.anchor }, post, probes, assets).catch((error) => {
        console.error(error);
        root.textContent = `zdrafts couldn't open this page: ${error}`;
      });
    }
  });
  post({ type: "frame-ready", path });
}

void main();
