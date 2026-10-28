// Starting a new site in the browser: pick a theme from the gallery, give the site a title.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CATALOG, type CatalogTheme } from "../themes/catalog.ts";

const HOSTS: Record<string, string> = { "github.com": "GitHub", "codeberg.org": "Codeberg", "gitlab.com": "GitLab" };
const hostOf = (repo: string) => {
  const host = new URL(repo).hostname;
  return HOSTS[host] ?? host;
};

/** A theme's screenshot, or its name when the gallery has none */
function Shot({ theme, lazy }: { theme: CatalogTheme; lazy?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [theme.screenshot]);
  if (failed) return <span className="ns-noshot" aria-hidden="true">{theme.name}</span>;
  return <img src={theme.screenshot} alt="" loading={lazy ? "lazy" : undefined} onError={() => setFailed(true)} />;
}

export function NewSite({
  busy,
  progress,
  error,
  onCreate,
  onCancel,
}: {
  busy: boolean;
  /** What creating the site is doing now */
  progress?: string;
  error?: string;
  onCreate: (theme: CatalogTheme, title: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<CatalogTheme | null>(null);
  const [title, setTitle] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const themes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? CATALOG.filter((theme) => `${theme.id} ${theme.name} ${theme.description} ${theme.repo}`.toLowerCase().includes(q)) : CATALOG;
  }, [query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const choose = (theme: CatalogTheme) => {
    setChosen(theme);
    // On narrow screens the details are below the grid
    requestAnimationFrame(() => titleInput.current?.focus({ preventScroll: window.innerWidth > 900 }));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen && title.trim()) onCreate(chosen, title.trim());
  };

  return (
    <main className="ns">
      <header className="ns-head">
        <button type="button" className="ns-back" onClick={onCancel} disabled={busy}>
          <span className="codicon codicon-arrow-left" aria-hidden="true" />
          Back
        </button>
        <h1>Start a new site</h1>
      </header>

      <section className="ns-gallery" aria-label="Themes">
        <div className="ns-search">
          <span className="codicon codicon-search" aria-hidden="true" />
          <input aria-label="Find a theme" placeholder={`Find a theme (${CATALOG.length} to choose from)`} value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
        </div>
        <div className="ns-grid" role="listbox" aria-label="Themes">
          {themes.map((theme) => (
            <button
              type="button"
              key={theme.id}
              role="option"
              aria-selected={chosen?.id === theme.id}
              className="ns-theme"
              onClick={() => choose(theme)}
              disabled={busy}
            >
              <Shot theme={theme} lazy />
              <span>{theme.name}</span>
            </button>
          ))}
        </div>
        {!themes.length && <p className="ns-empty">No theme matches “{query}”. Try a word from its name or description.</p>}
      </section>

      <aside className="ns-detail" aria-live="polite">
        {chosen ? (
          <form onSubmit={submit}>
            <div className="ns-frame">
              <div className="ns-frame-bar" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <Shot theme={chosen} />
            </div>
            <h2>{chosen.name}</h2>
            <p className="ns-desc">{chosen.description || "No description."}</p>
            <ul className="ns-links">
              <li>
                <a href={chosen.repo} target="_blank" rel="noreferrer">
                  <span className="codicon codicon-repo" aria-hidden="true" />
                  Source on {hostOf(chosen.repo)}
                </a>
              </li>
              {chosen.demo && (
                <li>
                  <a href={chosen.demo} target="_blank" rel="noreferrer">
                    <span className="codicon codicon-globe" aria-hidden="true" />
                    Demo site
                  </a>
                </li>
              )}
              {chosen.license && (
                <li>
                  <span className="codicon codicon-law" aria-hidden="true" />
                  {chosen.license} licence
                </li>
              )}
            </ul>
            <label className="ns-field">
              <span>Site title</span>
              <input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="My site" disabled={busy} />
            </label>
            <button className="btn ns-create" type="submit" disabled={!title.trim() || busy}>
              {busy ? <span className="codicon codicon-sync spin" aria-hidden="true" /> : null}
              {busy ? "Creating…" : "Create site"}
            </button>
            <p className="ns-note">
              {progress ??
                "Starts with the theme's demo pages. The site stays in this browser until you publish it to GitHub."}
            </p>
            {error && (
              <div className="error-box" role="alert">
                {error}
              </div>
            )}
          </form>
        ) : (
          <div className="ns-placeholder">
            <span className="codicon codicon-layout" aria-hidden="true" />
            <p>Choose a theme to see it here.</p>
            <p className="ns-note">
              These are the{" "}
              <a href="https://www.getzola.org/themes/" target="_blank" rel="noreferrer">
                Zola gallery
              </a>{" "}
              themes that zdrafts has tested.
            </p>
          </div>
        )}
      </aside>
    </main>
  );
}
