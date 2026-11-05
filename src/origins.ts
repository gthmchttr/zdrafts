// zdrafts runs on two origins. The app (the workbench, drafts and the GitHub token) on one, and the
// site's pages (theme scripts and all) in a sandbox on another, so nothing a theme runs can reach the
// app's storage or windows. The sandbox only holds build output.
//
// - Production: VITE_APP_ORIGIN and VITE_SANDBOX_ORIGIN at build time, both serving this same build.
//   Keep them on one site (subdomains of the same domain): browsers that block third-party storage
//   would otherwise block the sandbox's service worker inside the app.
// - Development: the app on localhost, the sandbox on 127.0.0.1 (same server, different origins).
// - Otherwise both are this page's origin, as before the sandbox existed: theme scripts then run
//   next to the token (see README, GitHub token).

function origins(): { app: string; sandbox: string } {
  const { VITE_APP_ORIGIN: app, VITE_SANDBOX_ORIGIN: sandbox } = import.meta.env;
  if (app && sandbox) return { app: new URL(app).origin, sandbox: new URL(sandbox).origin };
  const { protocol, hostname, port, origin } = location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    const at = port ? `:${port}` : "";
    return { app: `${protocol}//localhost${at}`, sandbox: `${protocol}//127.0.0.1${at}` };
  }
  return { app: origin, sandbox: origin };
}

export const { app: APP_ORIGIN, sandbox: SANDBOX_ORIGIN } = origins();

/** Whether the site's pages run apart from the app */
export const ISOLATED = APP_ORIGIN !== SANDBOX_ORIGIN;

/** Permissions of the frames showing the site: no navigating the app's tab away */
export const SITE_FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";
