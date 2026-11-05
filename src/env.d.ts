/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the app runs, e.g. https://zdrafts.example.com (src/origins.ts) */
  readonly VITE_APP_ORIGIN?: string;
  /** Where the site's pages run, e.g. https://zdrafts-site.example.com */
  readonly VITE_SANDBOX_ORIGIN?: string;
}
