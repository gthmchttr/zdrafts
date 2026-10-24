import { useEffect, useState, type FormEvent } from "react";
import { parseRepoInput, type GitHubErrorKind, type RepoRef } from "../repo/github.ts";
import { getToken, onTokenChange } from "../repo/token.ts";
import type { OpenProgress } from "./session.ts";
import { TokenDialog } from "./TokenDialog.tsx";

/** Why a token would help after a failed load, or null if it wouldn't */
function tokenReason(kind: GitHubErrorKind | undefined, repo: string): string | null {
  switch (kind) {
    case "rate-limit":
      return `GitHub limits requests without a token to 60 an hour. With a token, zdrafts can open ${repo} right away.`;
    case "not-found":
      return `If ${repo} is private, zdrafts needs a token with access to it.`;
    case "unauthorized":
    case "forbidden":
      return "The saved token didn't work for this repository. Add one that has access to it.";
    default:
      return null;
  }
}

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
  errorKind,
  failed,
  onOpen,
}: {
  recent: string[];
  loading: { ref: RepoRef; progress: OpenProgress | null } | null;
  error?: string;
  errorKind?: GitHubErrorKind;
  /** The repository that failed to open */
  failed?: RepoRef;
  onOpen: (ref: RepoRef) => void;
}) {
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [dialog, setDialog] = useState<{ reason?: string; retry?: RepoRef } | null>(null);
  const [token, setTokenState] = useState(getToken);
  useEffect(() => onTokenChange(() => setTokenState(getToken())), []);
  const failedName = failed ? `${failed.owner}/${failed.repo}` : "";
  const reason = failed ? tokenReason(errorKind, failedName) : null;

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
          Edit a Zola site's pages right in your browser, in the site's own look. Paste a GitHub repository: your edits stay here
          as drafts until you commit them or download them.
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
          {invalid ? "That doesn't look like a GitHub repository." : "Supported theme: zola-yolk on Zola 0.23. "}
          {!invalid && (
            <button type="button" className="link-btn" onClick={() => setDialog({})}>
              {token ? `GitHub token: ${token.login}` : "Add a GitHub token"}
            </button>
          )}
          {!invalid && !token && " for private repositories and committing."}
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
            {reason && (
              <div className="error-actions">
                <button type="button" className="btn" onClick={() => setDialog({ reason, retry: failed })}>
                  {token ? "Use another token" : "Add a GitHub token"}
                </button>
              </div>
            )}
          </div>
        )}
        {dialog && (
          <TokenDialog
            reason={dialog.reason}
            owner={dialog.retry?.owner}
            repo={dialog.retry ? `${dialog.retry.owner}/${dialog.retry.repo}` : undefined}
            onClose={() => setDialog(null)}
            onSaved={() => {
              const retry = dialog.retry;
              setDialog(null);
              if (retry) onOpen(retry);
            }}
          />
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
