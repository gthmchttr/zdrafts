import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
