// The site's page in an iframe, with the editor injected by the service worker, and the messages
// between them (src/frame/protocol.ts).
import { useEffect, useRef, useState } from "react";
import type { FrameToShell, ShellToFrame } from "../frame/protocol.ts";
import { splitFrontMatter } from "../markdown/frontmatter.ts";
import type { Session } from "./session.ts";
import { SITE_PREFIX } from "./site-cache.ts";

export function FramePane({
  session,
  path,
  url,
  onNavigate,
}: {
  session: Session;
  path: string;
  url: string;
  onNavigate: (path: string) => void;
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
        case "navigate": {
          const target = new URL(message.href, location.href);
          if (target.origin !== location.origin || !target.pathname.startsWith(`${SITE_PREFIX}/`)) {
            window.open(target.href, "_blank", "noopener");
            return;
          }
          const output = target.pathname.slice(SITE_PREFIX.length + 1).replace(/\/?$/, "/").replace(/^\//, "") + "index.html";
          const page = [...session.pages].find(([, out]) => out === output || out === output.replace(/^\/?index\.html$/, "index.html"));
          if (page) onNavigate(page[0]);
          break;
        }
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
