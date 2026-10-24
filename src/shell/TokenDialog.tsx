// Asks for a GitHub token when one is needed: private repositories, the API limit, committing.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { forgetToken, getToken, newTokenUrl, setToken, type StoredToken } from "../repo/token.ts";

export function TokenDialog({
  reason,
  owner,
  repo,
  onSaved,
  onClose,
}: {
  /** Why a token is being asked for; omitted when the user opened it themselves */
  reason?: string;
  /** Pre-fills the token's owner on GitHub's form */
  owner?: string;
  /** "owner/repo" the token should be given access to */
  repo?: string;
  onSaved: (token: StoredToken) => void;
  onClose: () => void;
}) {
  const current = getToken();
  const [value, setValue] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const token = value.trim();
    if (!token) return;
    setChecking(true);
    setError(null);
    try {
      // Only sent to GitHub, to check it works and whose it is
      const response = await fetch("https://api.github.com/user", {
        headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
      });
      if (response.status === 401) throw new Error("GitHub didn't accept this token. Check that it was copied in full and hasn't expired.");
      if (!response.ok) throw new Error(`GitHub couldn't check the token (HTTP ${response.status}).`);
      const { login } = (await response.json()) as { login: string };
      const stored = { token, login };
      setToken(stored, remember);
      onSaved(stored);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="token-title" onSubmit={submit}>
        <h2 id="token-title">
          <span className="codicon codicon-github" aria-hidden="true" />
          GitHub token
        </h2>
        {reason && <p className="dialog-reason">{reason}</p>}
        {current && (
          <p className="dialog-current">
            <span className="codicon codicon-account" aria-hidden="true" />
            Using a token for <strong>{current.login}</strong>.
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                forgetToken();
                onClose();
              }}
            >
              Forget it
            </button>
          </p>
        )}
        <ol className="dialog-steps">
          <li>
            <a href={newTokenUrl(owner)} target="_blank" rel="noreferrer">
              Create a fine-grained token on GitHub
            </a>
            . Under <em>Repository access</em>, choose <em>Only select repositories</em> and pick {repo ? <strong>{repo}</strong> : "your site's repository"}.
            <em> Contents: Read and write</em> is already selected.
          </li>
          <li>
            <label htmlFor="token-input">Paste it here:</label>
            <input
              id="token-input"
              ref={input}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="github_pat_…"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </li>
        </ol>
        <label className="dialog-check">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          Remember on this browser
        </label>
        <p className="dialog-note">
          The token is kept in this browser and only sent to api.github.com. Pages from your site shown in the editor run on the same origin, so
          limit the token to this repository.
        </p>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-buttons">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn" disabled={!value.trim() || checking}>
            {checking ? "Checking…" : "Save token"}
          </button>
        </div>
      </form>
    </div>
  );
}
