import { useState, type FormEvent } from "react";
import { parseRepoInput, type RepoRef } from "../repo/github.ts";
import type { OpenProgress } from "./session.ts";

const EXAMPLE = "gthmchttr/gthmchttr.com";

function describe(progress: OpenProgress | null): { label: string; fraction: number | null } {
  if (!progress) return { label: "Starting…", fraction: null };
  switch (progress.stage) {
    case "listing":
      return { label: progress.detail, fraction: null };
    case "downloading":
      return {
        label: `Downloading files: ${progress.done.toLocaleString()} of ${progress.total.toLocaleString()} (${(progress.bytes / 1048576).toFixed(1)} MB new)`,
        fraction: progress.total ? progress.done / progress.total : 0,
      };
    case "building":
      return { label: "Building the site with Zola…", fraction: null };
    case "done":
      return { label: "Done", fraction: 1 };
  }
}

export function Intro({
  recent,
  loading,
  error,
  onOpen,
}: {
  recent: string[];
  loading: { ref: RepoRef; progress: OpenProgress | null } | null;
  error?: string;
  onOpen: (ref: RepoRef) => void;
}) {
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const ref = parseRepoInput(input || EXAMPLE);
    setInvalid(!ref);
    if (ref) onOpen(ref);
  };

  const status = loading ? describe(loading.progress) : null;

  return (
    <main className="intro">
      <div className="intro-card">
        <h1>
          <span className="codicon codicon-edit" aria-hidden="true" />
          zdrafts
        </h1>
        <p className="lead">
          Edit a Zola site's pages right in your browser, in the site's own look. Paste a public GitHub repository: it loads
          read-only, and your edits stay here as drafts you can export.
        </p>
        <form onSubmit={submit}>
          <input
            aria-label="GitHub repository"
            placeholder={`owner/repo, owner/repo@branch or a github.com URL (e.g. ${EXAMPLE})`}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={!!loading}
            autoFocus
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={!!loading}>
            Open
          </button>
        </form>
        <div className="hint">
          {invalid ? "That doesn't look like a GitHub repository." : "Public repositories only, for now. Supported theme: zola-yolk on Zola 0.23."}
        </div>

        {status && (
          <div className="progress" role="status">
            <div className="progress-label">
              {loading!.ref.owner}/{loading!.ref.repo}: {status.label}
            </div>
            <div className={`progress-bar${status.fraction === null ? " indeterminate" : ""}`}>
              <div style={status.fraction === null ? undefined : { width: `${Math.round(status.fraction * 100)}%` }} />
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}

        {!loading && (
          <>
            <h2>{recent.length ? "Recent" : "Try"}</h2>
            <ul className="recent">
              {(recent.length ? recent : [EXAMPLE]).map((name) => (
                <li key={name}>
                  <button type="button" onClick={() => onOpen(parseRepoInput(name)!)}>
                    <span className="codicon codicon-repo" aria-hidden="true" />
                    {name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}
