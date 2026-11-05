// Files under static/ that Zola only copies (scripts, styles, fonts, icons, media) aren't
// downloaded when a site opens: a theme can ship thousands. The sandbox's service worker fetches one
// from GitHub when a page asks for it (public/sw.js), and a build that needs one after all (a
// stylesheet hashed by get_url(cachebust=true)…) names it in its error, so it's downloaded then.

/** Files Zola can read: images it resizes or measures, data for load_data */
const READABLE = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|json|toml|ya?ml|csv|bib|txt|xml)$/i;

/** The site's or a theme's static/ folder: "themes/x/static/" */
const STATIC = /^(?:themes\/[^/]+\/)?static\//;

/** Whether a file is downloaded when the site opens */
export function downloadedUpFront(path: string): boolean {
  return !STATIC.test(path) || READABLE.test(path);
}

/** Where a static file is served on the site: "themes/x/static/icons/a.svg" → "icons/a.svg" */
export function sitePath(path: string): string | null {
  const match = STATIC.exec(path);
  return match ? path.slice(match[0].length) : null;
}

/**
 * The files not downloaded that a failed build was missing: paths in Zola's errors, written as
 * templates give them ("icons/a.svg", "static/icons/a.svg", "/site/static/data.json"…).
 */
export function missingFiles(stderr: string[], notDownloaded: Iterable<string>): string[] {
  const bySitePath = new Map<string, string[]>();
  const byPath = new Set<string>();
  for (const path of notDownloaded) {
    byPath.add(path);
    const served = sitePath(path);
    if (served) bySitePath.set(served, [...(bySitePath.get(served) ?? []), path]);
  }
  const found = new Set<string>();
  for (const token of stderr.join("\n").match(/[\w@.~+%-]+(?:\/[\w@.~+%-]+)*\.\w+/g) ?? []) {
    const path = token.replace(/^\/?(?:site\/)?/, "");
    if (byPath.has(path)) found.add(path);
    for (const candidate of bySitePath.get(sitePath(path) ?? path) ?? []) found.add(candidate);
  }
  return [...found];
}

/**
 * Where each file not downloaded is served on the site, and the file: the site's static/ over its
 * theme's, as Zola copies them (other themes in themes/ aren't used).
 */
export function servedFiles(notDownloaded: Iterable<string>, theme: string | null): Map<string, string> {
  const own = new Map<string, string>();
  const themed = new Map<string, string>();
  for (const path of notDownloaded) {
    const served = sitePath(path);
    if (!served) continue;
    if (!path.startsWith("themes/")) own.set(served, path);
    else if (theme && path.startsWith(`themes/${theme}/`)) themed.set(served, path);
  }
  return new Map([...themed, ...own]);
}
