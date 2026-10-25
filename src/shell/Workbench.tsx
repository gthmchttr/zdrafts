import { zipSync } from "fflate";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { Explorer, fileIcon } from "./Explorer.tsx";
import { FramePane } from "./FramePane.tsx";
import type { Session } from "./session.ts";

type Mode = "visual" | "source";
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;

function useSession(session: Session) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => session.subscribe(rerender), [session]);
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function download(name: string, data: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workbench({ session, onClose }: { session: Session; onClose: () => void }) {
  useSession(session);
  const explorerPaths = useMemo(() => session.explorerPaths(), [session]);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [modes, setModes] = useState<Record<string, Mode>>({});
  const [panelOpen, setPanelOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const modified = new Set(session.drafts.paths());

  const open = useCallback((path: string) => {
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
  }, []);

  // Start on the first post, so there's something to see
  useEffect(() => {
    const first = session.contentPages.find((path) => session.pages.has(path) && !path.endsWith("_index.md")) ?? session.contentPages[0];
    if (first) open(first);
  }, [session, open]);

  const closeTab = (path: string) => {
    setTabs((current) => {
      const next = current.filter((tab) => tab !== path);
      if (active === path) setActive(next.at(-1) ?? null);
      return next;
    });
  };

  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  const exportChanges = () => {
    const files: Record<string, Uint8Array> = {};
    for (const path of session.drafts.paths()) files[path] = session.bytes(path)!;
    const name = `${session.repo.repo}-drafts-${new Date().toISOString().slice(0, 10)}.zip`;
    download(name, zipSync(files), "application/zip");
    setMenuOpen(false);
  };

  const copyMarkdown = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(session.text(active));
    setMenuOpen(false);
    notify(`Copied ${active.split("/").pop()}`);
  };

  const discard = async () => {
    if (!active) return;
    await session.discard(active);
    setMenuOpen(false);
    notify(`Discarded changes to ${active.split("/").pop()}`);
  };

  const mode: Mode = (active && modes[active]) || "visual";
  const isMarkdown = !!active && active.endsWith(".md");
  const status = session.status;
  const repoUrl = `https://github.com/${session.repo.owner}/${session.repo.repo}/tree/${session.repo.ref}`;

  return (
    <div className="workbench">
      <header className="titlebar">
        <span className="brand">
          <span className="codicon codicon-edit" aria-hidden="true" />
          zdrafts
        </span>
        <span className="repo">
          <a href={repoUrl} target="_blank" rel="noreferrer">
            {session.repo.owner}/{session.repo.repo} — {session.repo.ref}
          </a>
        </span>
        <div style={{ position: "relative" }}>
          <button className="icon-btn" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <span className="codicon codicon-git-commit" aria-hidden="true" />
            Changes
            {modified.size > 0 && <span className="badge">{modified.size}</span>}
          </button>
          {menuOpen && (
            <div className="menu" role="menu" style={{ right: 0, top: 30 }} onMouseLeave={() => setMenuOpen(false)}>
              {modified.size === 0 ? (
                <div className="menu-file" style={{ color: "var(--faint)" }}>
                  No changes yet
                </div>
              ) : (
                <div className="menu-files">
                  {[...modified].map((path) => (
                    <button key={path} className="menu-item menu-file" onClick={() => (open(path), setMenuOpen(false))}>
                      {path}
                    </button>
                  ))}
                </div>
              )}
              <div className="menu-sep" />
              <button className="menu-item" role="menuitem" disabled={modified.size === 0} onClick={exportChanges}>
                <span className="codicon codicon-desktop-download" aria-hidden="true" /> Download changed files (.zip)
              </button>
              <button className="menu-item" role="menuitem" disabled={!active} onClick={copyMarkdown}>
                <span className="codicon codicon-copy" aria-hidden="true" /> Copy this file's markdown
              </button>
              <button className="menu-item" role="menuitem" disabled={!active || !modified.has(active)} onClick={discard}>
                <span className="codicon codicon-discard" aria-hidden="true" /> Discard changes to this file
              </button>
            </div>
          )}
        </div>
        <button className="icon-btn" aria-pressed={panelOpen} title="Page settings (front matter)" onClick={() => setPanelOpen((v) => !v)}>
          <span className="codicon codicon-settings" aria-hidden="true" />
        </button>
        <button className="icon-btn" title="Open another site" onClick={onClose}>
          <span className="codicon codicon-close" aria-hidden="true" />
        </button>
      </header>

      <nav className="activity" aria-label="Views">
        <button className="active" title="Explorer" aria-current="true">
          <span className="codicon codicon-files" aria-hidden="true" />
        </button>
      </nav>

      <aside className="sidebar">
        <div className="sidebar-title">Explorer</div>
        <div className="section-header">
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
          {session.repo.repo}
        </div>
        <Explorer paths={explorerPaths} selected={active} modified={modified} onOpen={open} />
      </aside>

      <section className="editor">
        <div className="tabs" role="tablist">
          {tabs.map((path) => {
            const icon = fileIcon(path);
            return (
              <div
                key={path}
                role="tab"
                aria-selected={path === active}
                className={`tab${path === active ? " active" : ""}${modified.has(path) ? " modified" : ""}`}
                onClick={() => setActive(path)}
                onAuxClick={(event) => event.button === 1 && closeTab(path)}
                title={path}
              >
                <span className={`codicon codicon-${icon.icon} ${icon.className}`} aria-hidden="true" />
                <span className="name">{path.split("/").pop()}</span>
                <button
                  className="close"
                  aria-label={`Close ${path}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(path);
                  }}
                >
                  <span className="codicon codicon-close" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
        {active && (
          <div className="breadcrumbs">
            <span className="crumbs">{active.split("/").join(" › ")}</span>
            {isMarkdown && session.pages.has(active) && (
              <div className="mode-switch" role="group" aria-label="Editor mode">
                {(["visual", "source"] as Mode[]).map((m) => (
                  <button key={m} aria-pressed={mode === m} onClick={() => setModes((current) => ({ ...current, [active]: m }))}>
                    {m === "visual" ? "Visual" : "Source"}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="editor-body">
          <EditorBody session={session} path={active} mode={mode} onNavigate={open} />
          {logOpen && status.state === "failed" && (
            <div className="log" role="log">
              {status.errors?.join("\n")}
            </div>
          )}
        </div>
      </section>

      {panelOpen && active?.endsWith(".md") && <PagePanel key={active} session={session} path={active} />}

      <footer className="statusbar">
        <span className="item" title={`Commit ${session.repo.commit}`}>
          <span className="codicon codicon-git-branch" aria-hidden="true" />
          {session.repo.ref}
        </span>
        <span className="item">
          <span className="codicon codicon-cloud-download" aria-hidden="true" />
          read-only
        </span>
        <span className="spacer" />
        <button className="item" onClick={() => setLogOpen((v) => !v)} title={status.state === "failed" ? "Show build errors" : "Zola build"}>
          {status.state === "building" && <span className="codicon codicon-sync spin" aria-hidden="true" />}
          {status.state === "ok" && <span className="codicon codicon-check ok" aria-hidden="true" />}
          {status.state === "failed" && <span className="codicon codicon-error error" aria-hidden="true" />}
          {status.state === "building" ? "Building…" : status.state === "failed" ? "Build failed" : status.state === "ok" ? `Built in ${status.ms} ms` : ""}
        </button>
        <span className="item">Zola {session.site.zola?.replace(/^v/, "")}</span>
        <span className="item">
          <span className="codicon codicon-paintcan" aria-hidden="true" />
          {session.theme.name}
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function EditorBody({ session, path, mode, onNavigate }: { session: Session; path: string | null; mode: Mode; onNavigate: (path: string) => void }) {
  const saveText = useMemo(() => debounce((p: string, text: string) => void session.saveText(p, text), 400), [session]);
  if (!path) {
    return (
      <div className="empty">
        <div>
          <span className="codicon codicon-files" aria-hidden="true" />
          Open a page from the explorer
        </div>
      </div>
    );
  }
  if (IMAGE.test(path)) return <ImageView session={session} path={path} />;
  if (!path.endsWith(".md")) {
    return (
      <div className="empty">
        <div>
          <span className="codicon codicon-file-binary" aria-hidden="true" />
          {path.split("/").pop()} can't be edited here.
        </div>
      </div>
    );
  }
  const url = session.pageUrl(path, true);
  if (mode === "source" || !url) {
    return (
      <>
        {!url && (
          <div className="panel-note" style={{ borderTop: 0, borderBottom: "1px solid var(--border)" }}>
            This page's template doesn't display its content, so it can only be edited as Markdown.
          </div>
        )}
        <CodeEditor key={path} value={session.text(path)} language="markdown" label={`Markdown of ${path}`} onChange={(text) => saveText(path, text)} />
      </>
    );
  }
  return <FramePane key={`${path}:${session.layoutVersion}`} session={session} path={path} url={url} onNavigate={onNavigate} />;
}

function ImageView({ session, path }: { session: Session; path: string }) {
  const [info, setInfo] = useState("");
  const url = useMemo(() => {
    const data = session.bytes(path);
    return data ? URL.createObjectURL(new Blob([data as BlobPart], { type: path.endsWith(".svg") ? "image/svg+xml" : "" })) : "";
  }, [session, path]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const size = session.bytes(path)?.length ?? 0;
  return (
    <div className="image-view">
      <img
        src={url}
        alt={path}
        onLoad={(event) => setInfo(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
      />
      <span className="image-meta">
        {info} · {(size / 1024).toFixed(0)} KB
      </span>
    </div>
  );
}

function PagePanel({ session, path }: { session: Session; path: string }) {
  const split = splitFrontMatter(session.text(path));
  const delimiter = split.format === "yaml" ? "---" : "+++";
  const inner = split.frontMatter
    ? split.frontMatter.replace(/^(\+\+\+|---)[ \t]*\r?\n/, "").replace(/(?:\r?\n)?(\+\+\+|---)[ \t]*(\r?\n)?$/, "")
    : "";
  const saveRef = useRef(debounce((value: string) => {
    const body = splitFrontMatter(session.text(path)).body;
    const frontMatter = `${delimiter}\n${value}${value.endsWith("\n") || value === "" ? "" : "\n"}${delimiter}\n`;
    void session.saveText(path, frontMatter + body);
  }, 600));
  return (
    <aside className="panel" aria-label="Page settings">
      <div className="sidebar-title">Page settings · {split.format === "yaml" ? "YAML" : "TOML"}</div>
      <CodeEditor value={inner} language={split.format === "yaml" ? "yaml" : "toml"} label={`Front matter of ${path}`} onChange={(value) => saveRef.current(value)} />
      <div className="panel-note">Title, date, tags and other settings. The page reloads with the changes once Zola has rebuilt it.</div>
    </aside>
  );
}
