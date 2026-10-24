# zdrafts

Edit a [Zola](https://www.getzola.org) site's pages in the browser, in the site's own look.

Open a public GitHub repository, pick a page under `content/`, and edit it in place: the page is
built by Zola itself ([zola-wasi](https://github.com/gthmchttr/zola-wasi), running as WebAssembly
in a worker) and shown with the site's real theme. Headings, paragraphs and lists are typed
straight into the theme's markup, and theme components such as callouts or coloured text are
rendered by the theme and edited inline.

- Markdown shortcuts (`# `, `> `, `- `, `1. `, ` ``` `, `**bold**`…) and a `/` menu for blocks,
  headings (`/head`, `/h2`), tables, images, links and the theme's components (`/border`).
- A settings popover per component (the handle on hover) for its arguments.
- Page settings (front matter) and a Source view per file.
- Edits are kept as drafts in the browser (IndexedDB) per repository, marked in the explorer and
  listed in the Changes view, where they can be committed to the branch, downloaded as a zip,
  copied as Markdown or discarded.
- Links in the page open their page in zdrafts: content pages in the editor, generated pages
  (tags, search…) as read-only previews. Draft pages (`draft = true`) are built too.
- Saving keeps the file's own formatting: only the blocks you edited are rewritten.

## GitHub token

Public repositories open without one. A token is asked for when it's needed: to commit, to open a
private repository, or when GitHub's limit of 60 requests an hour without a token is used up.
Opening a site costs one request when it was opened before, four the first time.

Use a [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=zdrafts&contents=write)
with access to only the site's repository and *Contents: Read and write*. zdrafts commits with
the Git Data API and fast-forwards the branch, never force-pushes, and refuses to commit when
newer commits on the branch changed the same files.

The token stays in the browser (localStorage when "Remember" is ticked, otherwise until the tab
closes) and is only sent to api.github.com. Anything running on zdrafts' origin can read it,
including the site's pages shown in the editor, which is why the service worker serves them with a
Content-Security-Policy that blocks other origins' scripts and requests. For stronger isolation,
serve the built site from a separate origin (not done yet).

## Status

Early. Only tested setups are allowed:

| | Supported |
| --- | --- |
| Zola | 0.23.6 (from `ZOLA_VERSION` in the site's CI workflow, `netlify.toml` or `vercel.json`) |
| Themes | [zola-yolk](https://github.com/gauthamchettiar/zola-yolk) (`src/themes/`) |

Try it with [gthmchttr/gthmchttr.com](https://github.com/gthmchttr/gthmchttr.com).

Known limitations:

- Inline HTML in Markdown (e.g. `<u>…</u>`) shows as literal text.
- Components that transform their body (zola-yolk's `render`: Mermaid, math) are edited as source
  next to a preview.
- File contents come from `raw.githubusercontent.com` (public) or the API's blob endpoint
  (private repositories) and are cached in IndexedDB by blob SHA.
- Only edits to existing pages can be committed; creating, deleting and renaming files isn't supported yet.

## Development

```sh
npm install
npm run setup      # downloads zola.wasm + zola-wasi.js (v0.23.6) into public/zola/
npm run dev        # http://localhost:5173/?repo=gthmchttr/gthmchttr.com
npm run fixtures   # gthmchttr.com + zola-yolk at a pinned commit, for the tests
npm test           # Markdown round trip and source preservation on that content
npm run build      # static site in dist/
```

`dist/` is a static site, but it must be served from the root of its origin: the service worker
serves the built site at `/site/` and injects the editor (`/frame.js`) into its pages.

## How it works

```
Shell (React)                                    Site frame (iframe, same origin)
 intro · explorer · tabs · page settings          page HTML from Zola, theme CSS,
 drafts · export                                  site scripts removed, editor injected
      │  postMessage                                   ▲
      ▼                                                │ /site/*
 Zola worker (zola.wasm)  ── output ──►  Service worker (Cache Storage)
```

- `src/repo/`: loads the repository through the Git Trees API and raw file URLs, including
  submodules (themes), and detects the Zola version and theme.
- `src/zola/`: builds the site in a worker. Pages are built with their body replaced by a marker,
  so the theme renders all the chrome around it (`chrome.ts`). Components are rendered once with
  placeholder slots to learn where their content goes (`probe.ts`).
- `src/markdown/`: Tera syntax is swapped for placeholders before Markdown parsing, so
  `{% <warning> %}…{% </warning> %}` and `{{ <color … /> }}` become document nodes and are
  written back exactly (`tera.ts`, `remark-zola.ts`). `preserve.ts` keeps unedited blocks as they
  were in the file.
- `src/frame/`: the Milkdown editor mounted at the marker, with node views that use the theme's
  rendered component markup, the `/` menu and popovers (in a shadow root).
- `src/themes/`: per-theme adapters (edit-mode CSS, hidden components, menu hints).
