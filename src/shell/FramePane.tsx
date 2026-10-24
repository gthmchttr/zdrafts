// The site's page in an iframe, with the editor injected by the service worker, and the messages
// between them (src/frame/protocol.ts).
import { useEffect, useRef, useState } from "react";
import type { FrameToShell, ShellToFrame } from "../frame/protocol.ts";
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import type { Session } from "./session.ts";

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
          const results = await session.probe(message.calls);
          send({ type: "probe-result", id: message.id, results: [...results] });
          break;
        }
        case "navigate":
          onNavigate(message.href);
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
