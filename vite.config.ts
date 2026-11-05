import { copyFile } from "node:fs/promises";
import { codiconsCss } from "./src/shell/codicons-css.ts";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    // The codicons the UI uses, not the whole icon font (src/shell/codicons.ts)
    {
      name: "codicons",
      resolveId: (id) => (id === "virtual:codicons.css" ? "\0codicons.css" : null),
      load: (id) => (id === "\0codicons.css" ? codiconsCss() : null),
    },
    // Screens have their own paths (/new, /owner/repo: src/shell/routes.ts). Static hosts like
    // GitHub Pages serve 404.html for paths they don't have, so it's the app too.
    {
      name: "spa-fallback",
      apply: "build",
      writeBundle: ({ dir }) => copyFile(`${dir}/index.html`, `${dir}/404.html`),
    },
  ],
  worker: { format: "es" },
  // The app on localhost and the site's pages on 127.0.0.1: two origins, one server (src/origins.ts)
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    rollupOptions: {
      // The frame editor is injected into site pages by the service worker, so it needs a
      // stable URL: /frame.js (see registerServiceWorker in src/shell/site-cache.ts).
      // host.html: the sandbox's page that keeps builds for its service worker (src/sandbox/host.ts)
      input: { main: "index.html", host: "host.html", frame: "src/frame/main.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "frame" ? "frame.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
