import "@vscode/codicons/dist/codicon.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { APP_ORIGIN, ISOLATED } from "../origins.ts";
import { App } from "./App.tsx";

// The sandbox serves this same build, but the app (and the token) only ever runs on its own origin
const app = !ISOLATED || location.origin === APP_ORIGIN;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {app ? (
      <App />
    ) : (
      <main className="intro">
        <p>
          This is where zdrafts shows sites' pages. zdrafts itself is at <a href={APP_ORIGIN + location.pathname}>{APP_ORIGIN}</a>.
        </p>
      </main>
    )}
  </StrictMode>,
);
