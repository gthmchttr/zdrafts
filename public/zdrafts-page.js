// Added by the sandbox's service worker (public/sw.js) to every page of the site it serves, as
// /zdrafts-page.js?app=<the app's origin>&mode=<edit|preview|view>. It talks to the app (only to its
// origin) about the page in its frame:
// - the page's height, so on phones the app can make the frame as tall as the page (src/shell/narrow.ts);
// - previews: link clicks go to the app, which opens the page in zdrafts;
// - the view: links stay in /view/ (root-relative ones a theme hardcodes too), other sites open in a
//   new tab; the app asks for a reload when it has rebuilt the view.
(() => {
  const params = new URL(document.currentScript.src).searchParams;
  const app = params.get("app");
  const mode = params.get("mode");
  const framed = window.parent !== window;
  const post = (message) => framed && parent.postMessage(message, app);

  // Different for each page loaded: the app starts sizing the frame again for a new one
  const page = Math.random().toString(36).slice(2);
  let height = 0;
  const report = () => {
    const next = document.documentElement.scrollHeight;
    if (next !== height) post({ type: "zdrafts-size", height: (height = next), page });
  };
  const observer = new ResizeObserver(report);
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);
  addEventListener("load", report);

  if (mode === "preview") {
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest && event.target.closest("a[href]");
        if (!link || event.defaultPrevented || (link.pathname === location.pathname && link.hash)) return;
        event.preventDefault();
        post({ type: "navigate", href: link.href });
      },
      true,
    );
  }

  if (mode === "view") {
    document.addEventListener("click", (event) => {
      const link = event.target.closest && event.target.closest("a[href]");
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      if (link.origin !== location.origin) {
        if (framed) {
          event.preventDefault();
          window.open(link.href, "_blank", "noopener");
        }
      } else if (link.pathname !== "/view" && !link.pathname.startsWith("/view/")) {
        event.preventDefault();
        location.href = "/view" + link.pathname + link.search + link.hash;
      }
    });
    addEventListener("message", (event) => {
      if (event.origin === app && event.source === parent && event.data && event.data.type === "zdrafts-reload") location.reload();
    });
  }
})();
