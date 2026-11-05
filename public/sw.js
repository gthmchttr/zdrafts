// zdrafts service worker, on the sandbox's origin (src/origins.ts): serves the in-browser builds of
// the site, the editing build under /site/ and the view build (the site as `zola build` makes it)
// under /view/.
//
// The app sends each build to the sandbox's host page (src/sandbox/host.ts), which writes it into
// Cache Storage; this serves it so the site's own CSS, fonts, images and links work in the app's
// frames. Every page gets /zdrafts-page.js (public/zdrafts-page.js), which tells the app how tall
// it is and hands its links to the app (or, in the view, keeps them in /view/).
// - /view/ pages are served as built, scripts included.
// - A page requested with ?zdrafts-edit=<content path> is served for editing: the theme's scripts
//   are removed (they would rewrite the editable DOM; inline <head> scripts stay) and the zdrafts
//   editor is injected.
// - Other /site/ pages (previews of tags, search…) keep their scripts.
//
// When the sandbox is the app's own origin (no sandbox configured), the GitHub token is on this
// origin too, so pages get a Content-Security-Policy: only this origin's scripts and no requests to
// other origins. With a sandbox of its own, nothing secret is here, and previews and the view run
// everything the real site runs.
// Keep in sync with src/shell/site-host.ts
const CACHES = { "/site/": "zdrafts-site", "/view/": "zdrafts-view" };
const PARAMS = new URL(self.location.href).searchParams;
const FRAME_ENTRY = PARAMS.get("frame") || "/frame.js";
const APP_ORIGIN = PARAMS.get("app") || self.location.origin;
const ISOLATED = APP_ORIGIN !== self.location.origin;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // The site's home without its slash (base_url has none): "/view" → "/view/"
  if (`${url.pathname}/` in CACHES) return event.respondWith(Response.redirect(`${url.pathname}/${url.search}${url.hash}`, 302));
  const prefix = Object.keys(CACHES).find((prefix) => url.pathname.startsWith(prefix));
  if (!prefix) return;
  event.respondWith(serve(url, prefix));
});

async function serve(url, prefix) {
  const cache = await caches.open(CACHES[prefix]);
  const path = decodeURI(url.pathname);
  const candidates = path.endsWith("/") ? [`${path}index.html`] : [path, `${path}/index.html`];
  let response;
  for (const candidate of candidates) {
    response = await cache.match(candidate);
    if (response) break;
  }
  // A static file not downloaded with the site: from GitHub, the first time
  if (!response) response = await lazyFile(path.slice(prefix.length));
  if (!response) {
    return new Response(`<!doctype html><title>Not found</title><p style="font:14px system-ui;padding:2rem">${escapeHtml(path)} isn't part of this build.</p>`, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (!(response.headers.get("content-type") || "").startsWith("text/html")) return response;
  let html = await response.text();
  const edit = url.searchParams.get("zdrafts-edit");
  const mode = prefix === "/view/" ? "view" : edit ? "edit" : "preview";
  // At the end, not in <head>: a minified page may have no </head>, and nothing may go before its doctype
  const page = `<script src="/zdrafts-page.js?${new URLSearchParams({ app: APP_ORIGIN, mode })}"></script>`;
  if (!edit) return htmlResponse(html + page, ISOLATED ? null : PREVIEW_POLICY);
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
    inject(head + body, `<meta name="zdrafts-edit" content="${escapeHtml(edit)}"><script type="module" src="${escapeHtml(FRAME_ENTRY)}"></script>`) + page,
    policy,
  );
}

// Files not downloaded with the site (src/repo/lazy.ts): the host page (src/sandbox/host.ts) keeps
// their list, path on the site → [URL, type]; each is fetched once, then kept in the same cache.
// Keep in sync with src/sandbox/host.ts
const LAZY_CACHE = "zdrafts-lazy";
const LAZY_INDEX = "/__zdrafts__/lazy.json";
let lazyIndex = { version: null, files: {} };

async function lazyFile(sitePath) {
  const cache = await caches.open(LAZY_CACHE);
  const index = await cache.match(LAZY_INDEX);
  if (!index) return null;
  const version = index.headers.get("x-zdrafts-version");
  if (version !== lazyIndex.version) lazyIndex = { version, files: await index.json() };
  const file = Object.hasOwn(lazyIndex.files, sitePath) ? lazyIndex.files[sitePath] : null;
  if (!file) return null;
  const [url, type] = file;
  let body = await cache.match(url);
  if (!body) {
    const fetched = await fetch(url).catch(() => null);
    if (!fetched || !fetched.ok) return null;
    await cache.put(url, fetched.clone());
    body = fetched;
  }
  // GitHub serves most files as text/plain
  return new Response(body.body, { headers: { "content-type": type } });
}

async function sha256(text) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

function inject(html, tags) {
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tags}</head>`) : tags + html;
}

// Without a sandbox of its own: previews keep the theme's inline scripts (search, theme switchers);
// the editor needs none
const PREVIEW_POLICY = "script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
const EDIT_POLICY = "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

function htmlResponse(html, policy) {
  const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
  if (policy) headers["content-security-policy"] = policy;
  return new Response(html, { headers });
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
