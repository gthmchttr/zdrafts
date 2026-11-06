// The weekly theme check's steps (.github/workflows/themes.yml):
//   changed <status.json> [--all]   which themes to check, as a matrix: `themes=[{id, name, commit}]`
//                                   - its pinned commit, and the newest on its default branch, when
//                                   not checked yet (with --all, both anyway)
//   pin <id> <commit>               test that commit: set it in src/themes/<id>.toml
//   record <results dir> <status.json>   add the results (result-*.json) to the status
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { record, type ThemeStatus } from "../src/themes/status.ts";
import { CATALOG } from "./themes.ts";

const read = (path: string): ThemeStatus => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {});

const [command, ...args] = process.argv.slice(2);

if (command === "changed") {
  const status = read(args[0]);
  const all = args.includes("--all");
  const matrix: { id: string; name: string; commit: string }[] = [];
  for (const theme of CATALOG) {
    const latest = execFileSync("git", ["ls-remote", `${theme.repo}.git`, "HEAD"]).toString().split(/\s/)[0];
    const checked = new Set((status[theme.id] ?? []).map((check) => check.commit));
    for (const commit of new Set([theme.commit, latest])) {
      if (commit && (all || !checked.has(commit))) matrix.push({ id: theme.id, name: theme.name, commit });
    }
  }
  console.log(`themes=${JSON.stringify(matrix)}`);
} else if (command === "pin") {
  const [id, commit] = args;
  const path = join(import.meta.dirname, "..", "src", "themes", `${id}.toml`);
  writeFileSync(path, readFileSync(path, "utf8").replace(/^commit = ".*"$/m, `commit = "${commit}"`));
} else if (command === "record") {
  const [dir, path] = args;
  const results = readdirSync(dir)
    .filter((name) => /^result-.*\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
  writeFileSync(path, `${JSON.stringify(record(read(path), results, new Date().toISOString().slice(0, 10)), null, 2)}\n`);
} else {
  console.error("theme-status.ts changed | pin | record");
  process.exit(1);
}
