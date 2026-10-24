import { useCallback, useEffect, useRef, useState } from "react";
import { GitHubError, parseRepoInput, type GitHubErrorKind, type RepoRef } from "../repo/github.ts";
import { Intro } from "./Intro.tsx";
import { Session, SiteError, UnsupportedThemeError, type OpenProgress } from "./session.ts";
import { Workbench } from "./Workbench.tsx";

type State =
  | { screen: "intro"; error?: string; errorKind?: GitHubErrorKind; ref?: RepoRef }
  | { screen: "loading"; ref: RepoRef; progress: OpenProgress | null }
  | { screen: "workbench"; session: Session };

const RECENT_KEY = "zdrafts.recent";

function readRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function rememberRecent(name: string) {
  try {
    const list = [name, ...readRecent().filter((item) => item !== name)].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: recents are only a convenience
  }
}

/** ?repo=owner/name opens a site straight away, so links to a site work */
function repoFromUrl(): RepoRef | null {
  const param = new URLSearchParams(location.search).get("repo");
  return param ? parseRepoInput(param) : null;
}

export function App() {
  const [state, setState] = useState<State>({ screen: "intro" });
  const opening = useRef(0);

  const open = useCallback(async (ref: RepoRef) => {
    const attempt = ++opening.current;
    setState({ screen: "loading", ref, progress: null });
    const name = `${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ""}`;
    const url = new URL(location.href);
    url.searchParams.set("repo", name);
    history.replaceState(null, "", url);
    try {
      const session = await Session.open(ref, (progress) => {
        if (opening.current === attempt) setState({ screen: "loading", ref, progress });
      });
      if (opening.current !== attempt) return session.dispose();
      rememberRecent(name);
      setState({ screen: "workbench", session });
    } catch (error) {
      if (opening.current !== attempt) return;
      const known = error instanceof GitHubError || error instanceof SiteError || error instanceof UnsupportedThemeError;
      setState({
        screen: "intro",
        error: known ? (error as Error).message : `Something went wrong: ${(error as Error).message}`,
        errorKind: error instanceof GitHubError ? error.kind : undefined,
        ref,
      });
    }
  }, []);

  useEffect(() => {
    const ref = repoFromUrl();
    if (ref) void open(ref);
  }, [open]);

  const close = useCallback(() => {
    opening.current++;
    if (state.screen === "workbench") state.session.dispose();
    const url = new URL(location.href);
    url.searchParams.delete("repo");
    history.replaceState(null, "", url);
    setState({ screen: "intro" });
  }, [state]);

  if (state.screen === "workbench") return <Workbench session={state.session} onClose={close} />;
  return (
    <Intro
      recent={readRecent()}
      loading={state.screen === "loading" ? state : null}
      error={state.screen === "intro" ? state.error : undefined}
      errorKind={state.screen === "intro" ? state.errorKind : undefined}
      failed={state.screen === "intro" ? state.ref : undefined}
      onOpen={open}
    />
  );
}
