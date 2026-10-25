// Download zola.wasm and zola-wasi.js from a zola-wasi GitHub release into public/zola/<tag>/,
// verifying both against the release's SHA256SUMS. Run by `npm run setup`.
//
//   node scripts/fetch-zola.mjs            # every version in ZOLA_VERSIONS below
//   node scripts/fetch-zola.mjs v0.23.6    # one version
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "gthmchttr/zola-wasi";
// Zola versions zdrafts supports. Keep in sync with SUPPORTED_ZOLA in src/repo/site.ts.
const ZOLA_VERSIONS = ["v0.23.6"];
const ASSETS = ["zola.wasm", "zola-wasi.js"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

for (const tag of process.argv.slice(2).length ? process.argv.slice(2) : ZOLA_VERSIONS) {
  const base = `https://github.com/${REPO}/releases/download/${tag}`;
  const sums = new Map(
    new TextDecoder()
      .decode(await download(`${base}/SHA256SUMS`))
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/).reverse()),
  );
  const dir = join(root, "public", "zola", tag);
  mkdirSync(dir, { recursive: true });
  for (const asset of ASSETS) {
    const target = join(dir, asset);
    const expected = sums.get(asset);
    if (!expected) throw new Error(`${tag}: ${asset} isn't in SHA256SUMS`);
    if (existsSync(target) && sha256(readFileSync(target)) === expected) {
      console.log(`${tag}/${asset}: up to date`);
      continue;
    }
    const bytes = await download(`${base}/${asset}`);
    const actual = sha256(bytes);
    if (actual !== expected) throw new Error(`${tag}/${asset}: checksum ${actual}, expected ${expected}`);
    writeFileSync(target, bytes);
    console.log(`${tag}/${asset}: ${(bytes.length / 1048576).toFixed(1)} MB, verified`);
  }
}
