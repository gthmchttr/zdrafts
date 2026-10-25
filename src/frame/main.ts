// Runs inside the site's page (injected by public/sw.js): replaces the page's content marker with
// the editor, so everything around it is the theme's real markup and CSS.
import proseMirrorCss from "@milkdown/kit/prose/view/style/prosemirror.css?inline";
import tablesCss from "@milkdown/kit/prose/tables/style/tables.css?inline";
import { createEditor } from "./editor.ts";
import { Probes } from "./probes.ts";
import type { FrameToShell, ShellToFrame } from "./protocol.ts";
import editorCss from "./frame.css?inline";

const path = document.querySelector<HTMLMetaElement>('meta[name="zdrafts-edit"]')?.content ?? "";
const post = (message: FrameToShell) => window.parent.postMessage(message, location.origin);

function addStyle(css: string) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
}

/** Swap the content marker Zola rendered (see src/zola/chrome.ts) for the editor's root */
function mountPoint(): HTMLElement | null {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if ((node as Comment).data === `zdrafts:content:${path}`) {
      const root = document.createElement("div");
      root.className = "zd-root";
      node.parentNode!.replaceChild(root, node);
      return root;
    }
  }
  return null;
}

async function main() {
  addStyle(proseMirrorCss);
  addStyle(tablesCss);
  addStyle(editorCss);
  const root = mountPoint();
  if (!root) {
    document.body.insertAdjacentHTML("afterbegin", '<p style="font:14px system-ui;padding:1rem;background:#fee">zdrafts: this page\'s content area wasn\'t found.</p>');
    return;
  }

  // Links in the page's chrome open that page in zdrafts instead of navigating the frame
  document.addEventListener(
    "click",
    (event) => {
      const link = (event.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!link || root.contains(link) || event.defaultPrevented) return;
      event.preventDefault();
      post({ type: "navigate", href: link.href });
    },
    true,
  );

  const probes = new Probes(post);
  let started = false;
  window.addEventListener("message", (event: MessageEvent<ShellToFrame>) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    const message = event.data;
    if (message.type === "probe-result") probes.receive(message);
    else if (message.type === "doc" && message.path === path && !started) {
      started = true;
      addStyle(message.theme.editCss);
      createEditor(root, message, post, probes).catch((error) => {
        console.error(error);
        root.textContent = `zdrafts couldn't open this page: ${error}`;
      });
    }
  });
  post({ type: "frame-ready", path });
}

void main();
