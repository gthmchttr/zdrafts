import { copyFile } from "node:fs/promises";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    react(),
    // Screens have their own paths (/new, /owner/repo: src/shell/routes.ts). Static hosts like
    // GitHub Pages serve 404.html for paths they don't have, so it's the app too.
    {
      name: "spa-fallback",
      apply: "build",
      writeBundle: ({ dir }) => copyFile(`${dir}/index.html`, `${dir}/404.html`),
    },
  ],
  worker: { format: "es" },
  build: {
    target: "es2022",
    rollupOptions: {
      // The frame editor is injected into site pages by the service worker, so it needs a
      // stable URL: /frame.js (see registerServiceWorker in src/shell/site-cache.ts).
      input: { main: "index.html", frame: "src/frame/main.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "frame" ? "frame.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
