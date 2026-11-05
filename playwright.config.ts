// End-to-end tests (tests/e2e/), against the dev server: the app on localhost, the sandbox on
// 127.0.0.1 (src/origins.ts). Chromium by default; E2E_BROWSERS=chromium,firefox,webkit for more.
import { defineConfig, devices } from "@playwright/test";

const PORT = 5175;
const browsers = (process.env.E2E_BROWSERS ?? "chromium").split(",");
const DEVICES: Record<string, (typeof devices)[string]> = {
  chromium: devices["Desktop Chrome"],
  firefox: devices["Desktop Firefox"],
  webkit: devices["Desktop Safari"],
};

export default defineConfig({
  testDir: "tests/e2e",
  // Each test builds sites with Zola in the browser: one at a time
  workers: 1,
  timeout: 15 * 60_000,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1300, height: 900 } },
  projects: browsers.map((name) => ({ name, use: { ...DEVICES[name], viewport: { width: 1300, height: 900 } } })),
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
