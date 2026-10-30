// The site's page in an iframe, with the editor injected by the service worker, and the messages
// between them (src/frame/protocol.ts).
import { useEffect, useRef, useState } from "react";
import type { FrameToShell, ShellToFrame } from "../frame/protocol.ts";
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import { Session } from "./session.ts";

export function FramePane({
  session,
  path,
  url,
  onNavigate,
}: {
  session: Session;
  path: string;
  url: string;
  /** A link in the page was clicked */
  onNavigate: (href: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const send = (message: ShellToFrame) => frame.current?.contentWindow?.postMessage(message, location.origin);

    const onMessage = async (event: MessageEvent<FrameToShell>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      const message = event.data;
      switch (message.type) {
        case "frame-ready": {
          if (message.path !== path) return;
          setLoading(false);
          const theme = session.theme;
          send({
            type: "doc",
            path,
            body: splitFrontMatter(session.text(path)).body,
            components: [...session.components.values()],
            theme: { editCss: theme.editCss, hiddenComponents: theme.hiddenComponents, componentHints: theme.componentHints },
            staticImages: session.staticImages(),
            siteUrl: session.baseUrl,
          });
          break;
        }
        case "doc-change":
          if (message.path === path) await session.saveBody(path, message.body);
          break;
        case "probe": {
          const results = await session.probe(message.calls, path);
          send({ type: "probe-result", id: message.id, results: [...results] });
          break;
        }
        case "navigate":
          onNavigate(message.href);
          break;
        case "add-asset":
          try {
            const added = await session.addAsset(message.name, new Uint8Array(message.data));
            send({ type: "asset-added", id: message.id, src: Session.siteUrlOf(added) });
          } catch (error) {
            send({ type: "asset-added", id: message.id, error: String(error) });
          }
          break;
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session, path, onNavigate]);

  return (
    <>
      <iframe ref={frame} src={url} title={`Editing ${path}`} onLoad={() => setTimeout(() => setLoading(false), 3000)} />
      {loading && (
        <div className="progress-bar indeterminate" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <div />
        </div>
      )}
    </>
  );
}

/** A generated page (taxonomies, search…) as the site shows it, read-only */
export function PreviewPane({ url, onNavigate }: { url: string; onNavigate: (href: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameToShell>) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin) return;
      if (event.data.type === "navigate") onNavigate(event.data.href);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onNavigate]);
  return <iframe ref={frame} src={url} title={`Preview of ${url}`} />;
}

/** Whether a page is a draft (draft = true), which `zola build` leaves out */
export function isDraftPage(text: string): boolean {
  return /^[ \t]*draft[ \t]*[=:][ \t]*true\b/m.test(splitFrontMatter(text).frontMatter);
}

/**
 * A page of the site as `zola build` makes it, drafts applied, with the theme's scripts and links
 * working. Rebuilt when the drafts change; the frame stays on whatever page it was navigated to.
 */
export function ViewPane({ session, path }: { session: Session; path: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const draft = isDraftPage(session.text(path));
  const key = session.viewKey(draft);
  const [shown, setShown] = useState<{ key: string; url: string | null; errors: string[] } | null>(null);
  const output = session.pages.get(path);

  useEffect(() => {
    let current = true;
    void session.buildView(draft).then((build) => {
      if (!current) return;
      const url = build.ok && output && build.files.has(output) ? Session.viewUrlOf(output) : null;
      setShown((before) => {
        // Same page, new build: reload in place, keeping where the frame was navigated to
        if (before?.url && before.url === url) frame.current?.contentWindow?.location.reload();
        return { key, url, errors: build.ok ? [] : build.errors };
      });
    });
    return () => {
      current = false;
    };
  }, [session, draft, key, output]);

  return (
    <div className="view-pane">
      {draft && (
        <div className="panel-note" style={{ borderTop: 0, borderBottom: "1px solid var(--border)" }}>
          This page is a draft (draft = true), so <code>zola build</code> leaves it out of the site. It's shown as <code>zola serve --drafts</code> would.
        </div>
      )}
      {shown?.url && <iframe ref={frame} src={shown.url} title={`View of ${path}`} />}
      {shown && !shown.url && (
        <div className="empty">
          <div>
            <span className="codicon codicon-error" aria-hidden="true" />
            {shown.errors.length ? "The site doesn't build:" : "This page isn't part of the built site."}
            {shown.errors.length > 0 && <pre className="view-errors">{shown.errors.join("\n")}</pre>}
          </div>
        </div>
      )}
      {shown?.key !== key && (
        <div className="progress-bar indeterminate" style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
          <div />
        </div>
      )}
    </div>
  );
}
