// zdrafts service worker: serves the in-browser build of the site under /site/.
//
// The page writes each build's output into Cache Storage (src/shell/site-cache.ts); this serves it
// so the site's own CSS, fonts, images and links work in the preview iframe. A page requested with
// ?zdrafts-edit=<content path> is served for editing: the theme's scripts are removed (they would
// rewrite the editable DOM) and the zdrafts editor is injected.
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
  const edit = url.searchParams.get("zdrafts-edit");
  if (!edit || !(response.headers.get("content-type") || "").startsWith("text/html")) return response;

  let html = await response.text();
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "").replace(/<script\b[^>]*\/>/gi, "");
  const inject = `<meta name="zdrafts-edit" content="${escapeHtml(edit)}"><script type="module" src="${escapeHtml(FRAME_ENTRY)}"></script>`;
  html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${inject}</head>`) : inject + html;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
