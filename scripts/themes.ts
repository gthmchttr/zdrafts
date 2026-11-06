// The themes of src/themes/*.toml, read in Node (scripts and tests outside Vite; the app's
// src/themes/catalog.ts reads them with import.meta.glob)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseManifests } from "../src/themes/manifest.ts";

const DIR = join(import.meta.dirname, "..", "src", "themes");

export const THEMES = parseManifests(Object.fromEntries(readdirSync(DIR).filter((name) => name.endsWith(".toml")).map((name) => [name, readFileSync(join(DIR, name), "utf8")])));

export const CATALOG = THEMES.filter((theme) => theme.catalog);
