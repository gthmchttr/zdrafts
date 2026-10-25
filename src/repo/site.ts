// What kind of Zola site a loaded repository is: config file, Zola version, theme.
import { parse as parseToml } from "smol-toml";

/** zola.wasm builds zdrafts ships (public/zola/<tag>/), newest last. Keep in sync with scripts/fetch-zola.mjs */
export const SUPPORTED_ZOLA = ["v0.23.6"];

export interface SiteInfo {
  configPath: string;
  config: Record<string, unknown>;
  baseUrl: string;
  title: string;
  /** What the site deploys with, if it says (e.g. "0.23.6") */
  declaredZola: string | null;
  /** The zola.wasm zdrafts will use, e.g. "v0.23.6", or null when the version isn't supported */
  zola: string | null;
  theme: string | null;
}

const decoder = new TextDecoder();

/** ZOLA_VERSION in a CI workflow or netlify.toml, the usual way a Zola site pins its version */
function declaredZolaVersion(files: Map<string, Uint8Array>): string | null {
  for (const [path, data] of files) {
    if (!/^(\.github\/workflows\/.+\.ya?ml|netlify\.toml|\.gitlab-ci\.yml|vercel\.json)$/.test(path)) continue;
    const match = /ZOLA_VERSION["']?\s*[:=]\s*["']?v?(\d+\.\d+\.\d+)/.exec(decoder.decode(data));
    if (match) return match[1];
  }
  return null;
}

export class SiteError extends Error {}

export function inspectSite(files: Map<string, Uint8Array>): SiteInfo {
  const configPath = ["zola.toml", "config.toml"].find((path) => files.has(path));
  if (!configPath) throw new SiteError("This doesn't look like a Zola site: there's no zola.toml or config.toml at its root.");
  if (![...files.keys()].some((path) => path.startsWith("content/"))) {
    throw new SiteError("This Zola site has no content/ folder to edit.");
  }
  let config: Record<string, unknown>;
  try {
    config = parseToml(decoder.decode(files.get(configPath)!)) as Record<string, unknown>;
  } catch (error) {
    throw new SiteError(`${configPath} isn't valid TOML: ${(error as Error).message}`);
  }
  const declared = declaredZolaVersion(files);
  // Any 0.23.x site builds with the 0.23 zola.wasm we have; other lines aren't supported yet
  const line = declared ? `v${declared.split(".").slice(0, 2).join(".")}.` : null;
  const zola = declared ? (SUPPORTED_ZOLA.findLast((tag) => tag.startsWith(line!)) ?? null) : SUPPORTED_ZOLA.at(-1)!;
  return {
    configPath,
    config,
    baseUrl: String(config.base_url ?? ""),
    title: String(config.title ?? ""),
    declaredZola: declared,
    zola,
    theme: typeof config.theme === "string" ? config.theme : null,
  };
}
