# zdrafts

Edit a [Zola](https://www.getzola.org) site's pages in the browser, in the site's own look.

Open a GitHub repository (or start a new site with a theme), pick a page under `content/`, and edit it in place: the page is
built by Zola itself ([zola-wasi](https://github.com/gthmchttr/zola-wasi), running as WebAssembly
in a worker) and shown with the site's real theme. Headings, paragraphs and lists are typed
straight into the theme's markup, and theme components such as callouts or coloured text are
rendered by the theme and edited inline.

- Markdown shortcuts (`# `, `> `, `- `, `1. `, ` ``` `, `**bold**`…) and a `/` menu: Markdown
  blocks (`/head`, `/h2`, tables, images, links), then layout in HTML, then the theme's components,
  blocks before inline ones, each A to Z (`/border`).
- A settings popover per component (the handle on hover) for its arguments.
- A grip beside each block: click it to select the block (Delete removes it), drag it to move it.
- A formatting toolbar over selected text, and a context menu on right click (Shift + right click
  for the browser's own): bold, italic, strikethrough, code, links, wrapping text in the theme's
  inline components, turning blocks into headings, lists, quotes or code, code block language,
  and table rows, columns, column alignment and deletion. GFM tables always have one header row,
  the first, so it can't be removed or moved.
- Formatting that works in any theme, because it's written as HTML with inline styles (Zola passes
  HTML through, and Markdown between tags is still Markdown):
  - on selected text: text colour, highlight, underline, superscript, subscript, keyboard keys
    (`<span style="color: …">`, `<mark>`, `<u>`, `<sup>`, `<sub>`, `<kbd>`);
  - on a block (right click, or select it with its grip for a toolbar): alignment, a border, dashed
    border or shaded box, side-by-side columns that stack on narrow screens, and collapsible
    sections (`<div style="…">`, `<details>`). Changes reuse the block's wrapper, so they don't nest.
  - HTML already in a page shows as it renders: paired tags as editable elements, anything else
    rendered in place (edit it in the Source view).
- Code blocks are highlighted by Zola itself (the site's highlighting theme), live as you type.
- Drop or paste images into the page: they're added under `static/images/` and committed with the
  page. Images can also be dragged in from the explorer.
- The site's `zola.toml` can be edited too; the site rebuilds with it.
- Page settings (front matter) and a Source view per file.
- A View mode per page: the site as `zola build` makes it, with your drafts applied (real page
  bodies, the config as it is, the theme's scripts, links that work), rebuilt as you change
  things. Draft pages show as `zola serve --drafts` would. It opens in a new tab too, under `/view/`.
  Scripts from other origins are still blocked there (see GitHub token, below).
- Edits are kept as drafts in the browser (IndexedDB) per repository, marked in the explorer and
  listed in the Changes view, where they can be committed to the branch, downloaded as a zip,
  copied as Markdown or discarded.
- Links in the page open their page in zdrafts: content pages in the editor, generated pages
  (tags, search…) as read-only previews. Draft pages (`draft = true`) are built too.
- Saving keeps the file's own formatting: only the blocks you edited are rewritten.

## GitHub token

Public repositories open without one. A token is asked for when it's needed: to commit, to open a
private repository, or when GitHub's limit of 60 requests an hour without a token is used up.
Opening a site costs four requests the first time. After that, only the branch's latest commit is
asked for: free with a token when nothing changed (a conditional request), and without a token at
most once every 10 minutes. Trees are cached by commit and files by content hash.

Use a [fine-grained token](https://github.com/settings/personal-access-tokens/new?name=zdrafts&contents=write)
with access to only the site's repository and *Contents: Read and write*. zdrafts commits with
the Git Data API and fast-forwards the branch, never force-pushes, and refuses to commit when
newer commits on the branch changed the same files.

The token stays in the browser (localStorage when "Remember" is ticked, otherwise until the tab
closes) and is only sent to api.github.com. Anything running on zdrafts' origin can read it,
including the site's pages shown in the editor, which is why the service worker serves them with a
Content-Security-Policy that blocks other origins' scripts and requests. For stronger isolation,
serve the built site from a separate origin (not done yet).

## Themes

Any Zola 0.23 site works, with any theme or none: zdrafts edits pages inside whatever markup the
theme renders. What it does to make that general:

- Preview builds turn off `minify_html` (it would strip the markers that show where page content
  goes) and keep each page's headings, so the theme's table of contents is right.
- Components the theme's templates call (and pages don't), or that need template context such as
  `page` or `config`, are left out of the `/` menu.
- Collapsed `<details>` are opened while editing.
- Theme submodules on Codeberg (and other Forgejo/Gitea servers) and GitLab load too, as archives.

`src/themes/` can add hints for a theme (menu labels, CSS to show content it hides), but no theme
needs an adapter. `tests/theme-survey.test.ts` builds a new site with each theme in a folder of
theme repositories and checks the build, the editable pages and the components.

## New sites

**Start a new site with a theme** on the start screen picks one of the Zola theme gallery's themes
(`src/themes/catalog.ts`: the ones that build and edit in zdrafts, at the commit they were tested
at; themes on servers that don't let browsers download from them aren't listed). The new site has
the theme under `themes/`, the theme's demo config and content (pages that can't build in a
browser, e.g. ones that load data from the web, are left out), and a GitHub Pages workflow. It's
kept in this browser until **Publish to GitHub** (in Changes) creates a repository with it, the
theme as a git submodule, and turns on GitHub Pages; then it's edited from GitHub like any site.

## Status

Early.

| | Supported |
| --- | --- |
| Zola | 0.23.6 (from `ZOLA_VERSION` in the site's CI workflow, `netlify.toml` or `vercel.json`) |
| Themes | Any; 30 of the gallery's themes tested (see above) |

Try it with [gthmchttr/gthmchttr.com](https://github.com/gthmchttr/gthmchttr.com).

Known limitations:

- Components that transform their body (zola-yolk's `render`: Mermaid, math) are edited as source
  next to a preview.
- A section page whose template lists its pages without its own content is edited in the Source view.
- File contents come from `raw.githubusercontent.com` (public) or the API's blob endpoint
  (private repositories) and are cached in IndexedDB by blob SHA.
- In the explorer, pages and files can be created, renamed, moved (drag onto a folder) and deleted;
  folders can't be moved yet. Links to a moved page (`@/…`) or static file (`/…`) are updated.

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

## Credits

Icons are [Codicons](https://github.com/microsoft/vscode-codicons) by Microsoft, under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); the three text alignment icons are drawn
in their style.
