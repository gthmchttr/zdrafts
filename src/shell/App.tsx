import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { GitHubError, type GitHubErrorKind, type RepoRef } from "../repo/github.ts";
import { Intro } from "./Intro.tsx";
import { routeFromUrl, routePath, type Route } from "./routes.ts";
import { createLocalSite, deleteLocalSite, listLocalSites, type LocalSummary } from "../site/local.ts";
import type { CatalogTheme } from "../themes/catalog.ts";
import { Session, SiteError, type OpenProgress } from "./session.ts";
// Loaded on its own (CodeMirror is most of it), starting as soon as a site starts opening
const loadWorkbench = () => import("./Workbench.tsx");
const Workbench = lazy(() => loadWorkbench().then((module) => ({ default: module.Workbench })));

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

/** Show `route`'s URL; `replace` when it stands for the same screen (a new site getting its id) */
function setUrl(route: Route, replace = false) {
  const path = routePath(route);
  if (path === location.pathname + location.search) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
}

export function App() {
  const [state, setState] = useState<State>({ screen: "intro" });
  const [creating, setCreating] = useState(false);
  const opening = useRef(0);
  // The open site, closed when another screen's URL is shown (Back)
  const current = useRef<Session | null>(null);

  const [localSites, setLocalSites] = useState<LocalSummary[]>([]);
  const refreshLocal = useCallback(() => void listLocalSites().then(setLocalSites, () => setLocalSites([])), []);
  useEffect(refreshLocal, [refreshLocal]);

  /** Open a session, showing progress, unless another open started meanwhile */
  const start = useCallback(async (label: string, run: (onProgress: (progress: OpenProgress) => void) => Promise<Session>, failed?: RepoRef) => {
    const attempt = ++opening.current;
    void loadWorkbench();
    setState({ screen: "loading", label, progress: null });
    try {
      const session = await run((progress) => {
        if (opening.current === attempt) setState({ screen: "loading", label, progress });
      });
      if (opening.current !== attempt) return session.dispose();
      current.current?.dispose();
      current.current = session;
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
      setUrl({ kind: "repo", ref });
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
      setUrl({ kind: "local", id });
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
        setUrl({ kind: "local", id }, true);
        refreshLocal();
        return Session.openLocal(site.id, onProgress);
      });
    },
    [start, refreshLocal],
  );

  /** Leave the open site (or stop opening one) for the start screen */
  const leave = useCallback(() => {
    opening.current++;
    current.current?.dispose();
    current.current = null;
    refreshLocal();
    setState({ screen: "intro" });
  }, [refreshLocal]);

  /** Show the screen of the URL: on load, and on Back and Forward */
  const show = useCallback(
    (route: Route) => {
      // The URL in its usual form (/owner/repo for ?repo=owner/repo), so opening doesn't add a history entry
      setUrl(route, true);
      setCreating(route.kind === "new");
      if (route.kind === "repo") void open(route.ref);
      else if (route.kind === "local") void openLocal(route.id);
      else leave();
    },
    [open, openLocal, leave],
  );

  useEffect(() => {
    const onPop = () => show(routeFromUrl(new URL(location.href)));
    onPop();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [show]);

  const close = useCallback(() => {
    setUrl({ kind: "home" });
    leave();
  }, [leave]);

  const newSite = useCallback((open: boolean) => {
    setUrl({ kind: open ? "new" : "home" });
    setCreating(open);
  }, []);

  if (state.screen === "workbench") {
    return (
      <Suspense>
        <Workbench session={state.session} onClose={close} onOpenRepo={(ref) => (leave(), void open(ref))} />
      </Suspense>
    );
  }
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
      creating={creating}
      onNewSite={newSite}
      onCreate={(theme, title) => void create(theme, title)}
      onDeleteLocal={(id) => void deleteLocalSite(id).then(refreshLocal)}
    />
  );
}
