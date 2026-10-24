import { zipSync } from "fflate";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import { GitHubError } from "../repo/github.ts";
import { getToken, onTokenChange } from "../repo/token.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { Explorer, fileIcon } from "./Explorer.tsx";
import { FramePane, PreviewPane } from "./FramePane.tsx";
import type { Session } from "./session.ts";
import { TokenDialog } from "./TokenDialog.tsx";

type Mode = "visual" | "source";
type View = "explorer" | "changes";
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
/** Tabs for pages of the built site that aren't content files: "preview:/site/tags/" */
const PREVIEW = "preview:";

function previewTitle(tab: string): string {
  const path = new URL(tab.slice(PREVIEW.length), location.origin).pathname.replace(/^\/site\/?/, "").replace(/\/$/, "");
  return path || "home";
}

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
  // The sidebar's view; clicking the active view's icon hides the sidebar, as in VS Code
  const [view, setView] = useState<View | null>("explorer");
  const [token, setTokenState] = useState(getToken);
  useEffect(() => onTokenChange(() => setTokenState(getToken())), []);
  const [tokenDialog, setTokenDialog] = useState<{ reason?: string; then?: () => void } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const modified = new Set(session.drafts.paths());

  const open = useCallback((path: string) => {
    setTabs((current) => (current.includes(path) ? current : [...current, path]));
    setActive(path);
  }, []);

  const navigate = useCallback(
    (href: string) => {
      const target = session.resolveLink(href);
      if (target.kind === "page") open(target.path);
      else if (target.kind === "preview") open(PREVIEW + target.url);
      else window.open(target.href, "_blank", "noopener");
    },
    [session, open],
  );

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
  };

  const copyMarkdown = async (path: string) => {
    await navigator.clipboard.writeText(session.text(path));
    notify(`Copied ${path.split("/").pop()}`);
  };

  const discard = async (path: string) => {
    if (!confirm(`Discard your changes to ${path}? This can't be undone.`)) return;
    await session.discard(path);
    notify(`Discarded changes to ${path.split("/").pop()}`);
  };

  const defaultMessage = () => {
    const names = [...modified].map((path) => path.split("/").pop()!);
    return names.length === 1 ? `Update ${names[0]}` : `Update ${names.length} files`;
  };

  const commit = async () => {
    const { fullName, ref } = session.repo;
    if (!getToken()) {
      setTokenDialog({ reason: `To commit to ${fullName}, zdrafts needs a GitHub token that can write to it.`, then: commit });
      return;
    }
    setCommitting(true);
    setCommitError(null);
    try {
      const sha = await session.commit([...modified], commitMessage.trim() || defaultMessage());
      setCommitMessage("");
      notify(`Committed ${sha.slice(0, 7)} to ${ref}`);
    } catch (error) {
      const kind = error instanceof GitHubError ? error.kind : "other";
      const message = error instanceof Error ? error.message : String(error);
      if (kind === "unauthorized" || kind === "forbidden" || kind === "not-found") {
        setTokenDialog({ reason: `${message} The token needs Contents: Read and write on ${fullName}.`, then: commit });
      } else setCommitError(message);
    } finally {
      setCommitting(false);
    }
  };

  const toggleView = (next: View) => setView((current) => (current === next ? null : next));

  const mode: Mode = (active && modes[active]) || "visual";
  const isMarkdown = !!active && active.endsWith(".md");
  const isPreview = !!active?.startsWith(PREVIEW);
  const status = session.status;
  const repoUrl = `https://github.com/${session.repo.owner}/${session.repo.repo}/tree/${session.repo.ref}`;

  return (
    <div className={`workbench${view ? "" : " sidebar-hidden"}`}>
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
        <button className="icon-btn" aria-pressed={panelOpen} title="Page settings (front matter)" onClick={() => setPanelOpen((v) => !v)}>
          <span className="codicon codicon-settings" aria-hidden="true" />
        </button>
        <button className="icon-btn" title="Open another site" onClick={onClose}>
          <span className="codicon codicon-close" aria-hidden="true" />
        </button>
      </header>

      <nav className="activity" aria-label="Views">
        <button className={view === "explorer" ? "active" : ""} title="Explorer" aria-pressed={view === "explorer"} onClick={() => toggleView("explorer")}>
          <span className="codicon codicon-files" aria-hidden="true" />
        </button>
        <button
          className={view === "changes" ? "active" : ""}
          title={`Changes${modified.size ? ` (${modified.size})` : ""}`}
          aria-pressed={view === "changes"}
          onClick={() => toggleView("changes")}
        >
          <span className="codicon codicon-source-control" aria-hidden="true" />
          {modified.size > 0 && <span className="badge activity-badge">{modified.size}</span>}
        </button>
        <button className="activity-bottom" title={token ? `GitHub: ${token.login}` : "Add a GitHub token"} onClick={() => setTokenDialog({})}>
          <span className="codicon codicon-account" aria-hidden="true" />
        </button>
      </nav>

      <aside className="sidebar" hidden={view !== "explorer"}>
        <div className="sidebar-title">Explorer</div>
        <div className="section-header">
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
          {session.repo.repo}
        </div>
        <Explorer paths={explorerPaths} selected={active} modified={modified} onOpen={open} />
      </aside>
      {view === "changes" && (
        <aside className="sidebar">
          <div className="sidebar-title">
            Changes
            <span className="spacer" />
            <button className="icon-btn" title="Download changed files (.zip)" disabled={modified.size === 0} onClick={exportChanges}>
              <span className="codicon codicon-desktop-download" aria-hidden="true" />
            </button>
          </div>
          <form
            className="commit-box"
            onSubmit={(event) => {
              event.preventDefault();
              void commit();
            }}
          >
            <textarea
              aria-label="Commit message"
              placeholder={modified.size ? `Message (${defaultMessage()})` : "Message"}
              rows={2}
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void commit();
                }
              }}
            />
            <button type="submit" className="btn" disabled={modified.size === 0 || committing} title={`Commit and push to ${session.repo.fullName}`}>
              <span className={`codicon ${committing ? "codicon-sync spin" : "codicon-check"}`} aria-hidden="true" />
              {committing ? "Committing…" : `Commit to ${session.repo.ref}`}
            </button>
            {commitError && (
              <div className="error-box" role="alert">
                {commitError}
              </div>
            )}
          </form>
          <div className="section-header">
            <span className="codicon codicon-chevron-down" aria-hidden="true" />
            Drafts
            {modified.size > 0 && <span className="badge">{modified.size}</span>}
          </div>
          {modified.size === 0 ? (
            <div className="sidebar-note">No changes yet. Edits are kept in this browser until you download them.</div>
          ) : (
            <div className="changes" role="list">
              {[...modified].map((path) => {
                const icon = fileIcon(path);
                const slash = path.lastIndexOf("/");
                return (
                  <div key={path} role="listitem" className={`change-row${path === active ? " selected" : ""}`} onClick={() => open(path)} title={path}>
                    <span className={`file-icon codicon codicon-${icon.icon} ${icon.className}`} aria-hidden="true" />
                    <span className="name">{path.slice(slash + 1)}</span>
                    <span className="dir">{path.slice(0, slash)}</span>
                    <span className="actions">
                      <button className="icon-btn" title="Copy markdown" onClick={(event) => (event.stopPropagation(), void copyMarkdown(path))}>
                        <span className="codicon codicon-copy" aria-hidden="true" />
                      </button>
                      <button className="icon-btn" title="Discard changes" onClick={(event) => (event.stopPropagation(), void discard(path))}>
                        <span className="codicon codicon-discard" aria-hidden="true" />
                      </button>
                    </span>
                    <span className="status">M</span>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      )}

      <section className="editor">
        <div className="tabs" role="tablist">
          {tabs.map((path) => {
            const preview = path.startsWith(PREVIEW);
            const icon = preview ? { icon: "preview", className: "" } : fileIcon(path);
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
                <span className="name">{preview ? previewTitle(path) : path.split("/").pop()}</span>
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
            <span className="crumbs">{isPreview ? `Preview › ${previewTitle(active)} (generated by the theme, read-only)` : active.split("/").join(" › ")}</span>
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
          <EditorBody session={session} path={active} mode={mode} onNavigate={navigate} />
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
        <button className="item" onClick={() => setTokenDialog({})} title={token ? "GitHub token" : "Add a GitHub token to commit"}>
          <span className="codicon codicon-account" aria-hidden="true" />
          {token ? token.login : "No GitHub token"}
        </button>
        {session.repo.stale && (
          <span className="item warning" title={session.repo.stale}>
            <span className="codicon codicon-warning" aria-hidden="true" />
            Not the latest commit
          </span>
        )}
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
      {tokenDialog && (
        <TokenDialog
          reason={tokenDialog.reason}
          owner={session.repo.owner}
          repo={session.repo.fullName}
          onClose={() => setTokenDialog(null)}
          onSaved={() => {
            const then = tokenDialog.then;
            setTokenDialog(null);
            then?.();
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function EditorBody({ session, path, mode, onNavigate }: { session: Session; path: string | null; mode: Mode; onNavigate: (href: string) => void }) {
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
  if (path.startsWith(PREVIEW)) {
    const url = new URL(path.slice(PREVIEW.length), location.origin);
    url.searchParams.set("zdrafts-preview", "");
    return <PreviewPane key={`${path}:${session.layoutVersion}`} url={url.pathname + url.search + url.hash} onNavigate={onNavigate} />;
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
