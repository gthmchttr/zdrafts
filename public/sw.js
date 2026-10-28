// zdrafts service worker: serves the in-browser build of the site under /site/.
//
// The page writes each build's output into Cache Storage (src/shell/site-cache.ts); this serves it
// so the site's own CSS, fonts, images and links work in the preview iframe. A page requested with
// ?zdrafts-edit=<content path> is served for editing: the theme's scripts are removed (they would
// rewrite the editable DOM; inline <head> scripts stay) and the zdrafts editor is injected. One requested with ?zdrafts-preview
// keeps its scripts and only gets its link clicks handed to zdrafts.
//
// Site pages run on zdrafts' origin, where the GitHub token is stored (src/repo/token.ts), so every
// page gets a Content-Security-Policy: only scripts from this origin (the site's own and the
// editor), and no requests to other origins (analytics, embeds' scripts…).
const CACHE = "zdrafts-site";
const FRAME_ENTRY = new URL(self.location.href).searchParams.get("frame") || "/frame.js";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/site/")) return;
  event.respondWith(serve(url));
});

async function serve(url) {
  const cache = await caches.open(CACHE);
  const path = decodeURI(url.pathname);
  const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`];
  let response;
  for (const candidate of candidates) {
    response = await cache.match(candidate);
    if (response) break;
  }
  if (!response) {
    return new Response(`<!doctype html><title>Not found</title><p style="font:14px system-ui;padding:2rem">${escapeHtml(path)} isn't part of this build.</p>`, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!(response.headers.get("content-type") || "").startsWith("text/html")) return response;
  const edit = url.searchParams.get("zdrafts-edit");
  let html = await response.text();
  if (!edit) return htmlResponse(inject(html, `<script>${LINKS}</script>`), PREVIEW_POLICY);
  // Inline scripts in <head> stay: they set the page up before it's drawn (dark mode, the skin's
  // stylesheet) and don't touch content, which doesn't exist yet. Everything else goes: external
  // scripts and anything in <body> would rewrite the page being edited.
  // A theme's own policy (<meta http-equiv="Content-Security-Policy">) would block the editor's
  // script; while editing, the policy is the one this service worker sets
  html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");
  const end = html.search(/<\/head>/i);
  let head = end >= 0 ? html.slice(0, end) : "";
  const body = (end >= 0 ? html.slice(end) : html).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
  const kept = [];
  head = head
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (script, attrs, code) => {
      if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']?module/i.test(attrs)) return "";
      // Data (JSON-LD…) isn't run; classic scripts are allowed by their hash, so nothing else inline runs
      if (!/\btype\s*=/i.test(attrs) || /\btype\s*=\s*["']?(text|application)\/(javascript|ecmascript)/i.test(attrs)) kept.push(code);
      return script;
    })
    .replace(/<script\b[^>]*\/>/gi, "");
  const hashes = await Promise.all(kept.map(sha256));
  const policy = EDIT_POLICY.replace("script-src 'self'", ["script-src 'self'", ...hashes.map((hash) => `'sha256-${hash}'`)].join(" "));
  return htmlResponse(
    inject(head + body, `<meta name="zdrafts-edit" content="${escapeHtml(edit)}"><script type="module" src="${escapeHtml(FRAME_ENTRY)}"></script>`),
    policy,
  );
}

async function sha256(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

// Same as the editor's link handling (src/frame/main.ts): zdrafts decides where a link goes
const LINKS = `document.addEventListener("click", (event) => {
  const link = event.target.closest && event.target.closest("a[href]");
  if (!link || event.defaultPrevented || (link.pathname === location.pathname && link.hash)) return;
  event.preventDefault();
  parent.postMessage({ type: "navigate", href: link.href }, location.origin);
}, true);`;

function inject(html, tags) {
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tags}</head>`) : tags + html;
}

// Previews keep the theme's inline scripts (search, theme switchers); the editor needs none
const PREVIEW_POLICY = "script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const EDIT_POLICY = "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

function htmlResponse(html, policy) {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": policy },
  });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
