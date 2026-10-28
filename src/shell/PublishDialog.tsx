// Publishing a site made in this browser to a GitHub repository.
import { useState, type FormEvent } from "react";
import { GitHubError } from "../repo/github.ts";
import { getToken } from "../repo/token.ts";
import { markPublished } from "../site/local.ts";
import { CreateRepoError, newRepoUrl, publish, type Published, type PublishTarget } from "../site/publish.ts";
import { slugify } from "./files.ts";
import type { Session } from "./session.ts";
import { TokenDialog } from "./TokenDialog.tsx";

/** The site's files as they are now, without the theme (it becomes a submodule) */
function siteFiles(session: Session, themeDir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const paths = new Set([...session.repo.files.keys(), ...session.drafts.paths()]);
  for (const path of paths) {
    if (path.startsWith(`${themeDir}/`) || !session.exists(path)) continue;
    const data = session.bytes(path);
    if (data) files.set(path, data);
  }
  return files;
}

export function PublishDialog({ session, onClose, onOpenRepo }: { session: Session; onClose: () => void; onOpenRepo: (owner: string, name: string) => void }) {
  const token = getToken();
  const [owner, setOwner] = useState(token?.login ?? "");
  const [name, setName] = useState(slugify(session.repo.repo));
  const [isPrivate, setPrivate] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; createUrl?: string; exists?: boolean } | null>(null);
  const [done, setDone] = useState<Published | null>(null);
  const [needToken, setNeedToken] = useState(!token);

  const [themeDir, theme] = [...session.repo.submodules][0] ?? [];

  const run = async (existing: boolean) => {
    if (!theme) return;
    setError(null);
    setStep("Starting…");
    const target: PublishTarget = { owner: owner.trim(), name: name.trim(), private: isPrivate, existing };
    try {
      const result = await publish(
        { title: session.repo.repo, files: siteFiles(session, themeDir), themeDir: themeDir.replace(/^themes\//, ""), themeRepo: theme.source, themeCommit: theme.commit },
        target,
        setStep,
      );
      if (session.repo.local) await markPublished(session.repo.local, result.fullName);
      // Everything is on GitHub now: the local edits are part of it
      for (const path of session.drafts.paths()) await session.drafts.discard(path);
      setDone(result);
    } catch (failure) {
      if (failure instanceof CreateRepoError) setError({ message: failure.message, createUrl: failure.newRepoUrl });
      else if (failure instanceof GitHubError && failure.kind === "conflict" && !existing) setError({ message: failure.message, exists: true });
      else if (failure instanceof GitHubError && ["unauthorized", "forbidden"].includes(failure.kind)) {
        setError({ message: `${failure.message} The token needs Contents and Workflows: Read and write on ${target.owner}/${target.name}.` });
      } else setError({ message: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      setStep(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!getToken()) return setNeedToken(true);
    void run(false);
  };

  if (needToken) {
    return (
      <TokenDialog
        publish
        reason="Publishing creates a GitHub repository for the site, so zdrafts needs a GitHub token that can create repositories and write their content and workflows."
        onClose={onClose}
        onSaved={(saved) => {
          setOwner((current) => current || saved.login);
          setNeedToken(false);
        }}
      />
    );
  }

  const repoUrl = done ? `https://github.com/${done.fullName}` : "";
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !step && onClose()}>
      {done ? (
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="published-title">
          <h2 id="published-title">
            <span className="codicon codicon-check" aria-hidden="true" /> Published
          </h2>
          <p className="dialog-reason">
            The site is on GitHub at{" "}
            <a href={repoUrl} target="_blank" rel="noreferrer">
              {done.fullName}
            </a>
            , with its theme as a submodule.
          </p>
          <ul className="dialog-steps">
            {done.withoutWorkflow ? (
              <li>The deploy workflow was left out: the token can't write workflows. Add .github/workflows/deploy.yml with a token that can, or deploy another way.</li>
            ) : (
              <li>
                It builds with GitHub Actions on every commit (
                <a href={`${repoUrl}/actions`} target="_blank" rel="noreferrer">
                  Actions
                </a>
                ).
              </li>
            )}
            <li>
              {done.pages ? "GitHub Pages is on" : "Turn on GitHub Pages with the source “GitHub Actions”"} (
              <a href={`${repoUrl}/settings/pages`} target="_blank" rel="noreferrer">
                Pages settings
              </a>
              ). Set base_url in zola.toml to the site's address when you know it.
            </li>
          </ul>
          <div className="dialog-buttons">
            <button type="button" className="btn secondary" onClick={onClose}>
              Stay here
            </button>
            <button type="button" className="btn" onClick={() => onOpenRepo(...(done.fullName.split("/") as [string, string]))}>
              Continue editing it from GitHub
            </button>
          </div>
        </div>
      ) : (
        <form className="dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title" onSubmit={submit}>
          <h2 id="publish-title">
            <span className="codicon codicon-github" aria-hidden="true" /> Publish to GitHub
          </h2>
          <p className="dialog-reason">A new repository with the site, its theme as a git submodule, and a workflow that publishes it with GitHub Pages.</p>
          <div className="dialog-row">
            <label className="dialog-field">
              <span>Owner</span>
              <input value={owner} onChange={(event) => setOwner(event.target.value)} spellCheck={false} />
            </label>
            <span className="dialog-slash">/</span>
            <label className="dialog-field">
              <span>Repository</span>
              <input value={name} onChange={(event) => setName(event.target.value)} spellCheck={false} />
            </label>
          </div>
          <label className="dialog-check">
            <input type="checkbox" checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} />
            Private repository
          </label>
          {step && <p className="dialog-note">{step}</p>}
          {error && (
            <div className="error-box" role="alert">
              {error.message}
              {(error.createUrl || error.exists) && (
                <div className="error-actions">
                  {error.createUrl && (
                    <a className="btn secondary" href={error.createUrl} target="_blank" rel="noreferrer">
                      Create it on GitHub
                    </a>
                  )}{" "}
                  <button type="button" className="btn" onClick={() => void run(true)}>
                    {error.createUrl ? "I've created it: publish into it" : "Publish into the existing repository"}
                  </button>
                </div>
              )}
            </div>
          )}
          {!error?.createUrl && (
            <p className="dialog-note">
              Need to create it yourself?{" "}
              <a href={newRepoUrl({ owner, name, private: isPrivate })} target="_blank" rel="noreferrer">
                New repository on GitHub
              </a>
              , then publish into it.
            </p>
          )}
          <div className="dialog-buttons">
            <button type="button" className="btn secondary" onClick={onClose} disabled={!!step}>
              Cancel
            </button>
            <button type="submit" className="btn" disabled={!!step || !owner.trim() || !name.trim()}>
              {step ? "Publishing…" : "Publish"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
