import { useCallback, useEffect, useRef, useState } from "react";
import { GitHubError, parseRepoInput, type GitHubErrorKind, type RepoRef } from "../repo/github.ts";
import { Intro } from "./Intro.tsx";
import { createLocalSite, deleteLocalSite, listLocalSites, type LocalSummary } from "../site/local.ts";
import type { CatalogTheme } from "../themes/catalog.ts";
import { Session, SiteError, type OpenProgress } from "./session.ts";
import { Workbench } from "./Workbench.tsx";

type State =
  | { screen: "intro"; error?: string; errorKind?: GitHubErrorKind; ref?: RepoRef }
  | { screen: "loading"; label: string; progress: OpenProgress | null }
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

/** ?local=<id>: a site made in this browser */
const localFromUrl = () => new URLSearchParams(location.search).get("local");

function setUrl(key: "repo" | "local" | null, value = "") {
  const url = new URL(location.href);
  url.searchParams.delete("repo");
  url.searchParams.delete("local");
  if (key) url.searchParams.set(key, value);
  history.replaceState(null, "", url);
}

export function App() {
  const [state, setState] = useState<State>({ screen: "intro" });
  const opening = useRef(0);

  const [localSites, setLocalSites] = useState<LocalSummary[]>([]);
  const refreshLocal = useCallback(() => void listLocalSites().then(setLocalSites, () => setLocalSites([])), []);
  useEffect(refreshLocal, [refreshLocal]);

  /** Open a session, showing progress, unless another open started meanwhile */
  const start = useCallback(async (label: string, run: (onProgress: (progress: OpenProgress) => void) => Promise<Session>, failed?: RepoRef) => {
    const attempt = ++opening.current;
    setState({ screen: "loading", label, progress: null });
    try {
      const session = await run((progress) => {
        if (opening.current === attempt) setState({ screen: "loading", label, progress });
      });
      if (opening.current !== attempt) return session.dispose();
      setState({ screen: "workbench", session });
    } catch (error) {
      if (opening.current !== attempt) return;
      const known = error instanceof GitHubError || error instanceof SiteError;
      setState({
        screen: "intro",
        error: known ? (error as Error).message : `Something went wrong: ${(error as Error).message}`,
        errorKind: error instanceof GitHubError ? error.kind : undefined,
        ref: failed,
      });
    }
  }, []);

  const open = useCallback(
    async (ref: RepoRef) => {
      const name = `${ref.owner}/${ref.repo}${ref.ref ? `@${ref.ref}` : ""}`;
      setUrl("repo", name);
      await start(`${ref.owner}/${ref.repo}`, async (onProgress) => {
        const session = await Session.open(ref, onProgress);
        rememberRecent(name);
        return session;
      }, ref);
    },
    [start],
  );

  const openLocal = useCallback(
    async (id: string) => {
      setUrl("local", id);
      await start("Your site", (onProgress) => Session.openLocal(id, onProgress));
    },
    [start],
  );

  const create = useCallback(
    async (theme: CatalogTheme, title: string) => {
      let id = "";
      await start(title, async (onProgress) => {
        const site = await createLocalSite(theme, title, onProgress);
        id = site.id;
        setUrl("local", id);
        refreshLocal();
        return Session.openLocal(site.id, onProgress);
      });
    },
    [start, refreshLocal],
  );

  useEffect(() => {
    const ref = repoFromUrl();
    const local = localFromUrl();
    if (ref) void open(ref);
    else if (local) void openLocal(local);
  }, [open, openLocal]);

  const close = useCallback(() => {
    opening.current++;
    if (state.screen === "workbench") state.session.dispose();
    setUrl(null);
    refreshLocal();
    setState({ screen: "intro" });
  }, [state, refreshLocal]);

  if (state.screen === "workbench") return <Workbench session={state.session} onClose={close} onOpenRepo={(ref) => (state.session.dispose(), void open(ref))} />;
  return (
    <Intro
      recent={readRecent()}
      loading={state.screen === "loading" ? state : null}
      error={state.screen === "intro" ? state.error : undefined}
      errorKind={state.screen === "intro" ? state.errorKind : undefined}
      failed={state.screen === "intro" ? state.ref : undefined}
      onOpen={open}
      localSites={localSites}
      onOpenLocal={(id) => void openLocal(id)}
      onCreate={(theme, title) => void create(theme, title)}
      onDeleteLocal={(id) => void deleteLocalSite(id).then(refreshLocal)}
    />
  );
}
