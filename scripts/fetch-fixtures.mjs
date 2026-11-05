// Clone the sites the tests run against into tests/fixtures/ (gitignored), at pinned commits, and
// the themes new sites can start from (src/themes/catalog.ts) into tests/fixtures/themes/, at the
// commits the catalog gives: the end-to-end tests serve them in place of GitHub.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "../src/themes/catalog.ts";

const FIXTURES = [
  { name: "gthmchttr.com", repo: "https://github.com/gthmchttr/gthmchttr.com.git", commit: "6c6070cca7726a2a6c411cc2a0712b6de76dd163" },
  ...CATALOG.map((theme) => ({ name: `themes/${theme.id}`, repo: `${theme.repo}.git`, commit: theme.commit })),
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures");
mkdirSync(root, { recursive: true });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "inherit" });

for (const { name, repo, commit } of FIXTURES) {
  const dir = join(root, name);
  mkdirSync(dirname(dir), { recursive: true });
  if (!existsSync(join(dir, ".git"))) git(root, "init", "-q", dir);
  git(dir, "fetch", "-q", "--depth", "1", repo, commit);
  git(dir, "-c", "advice.detachedHead=false", "checkout", "-q", "--force", commit);
  git(dir, "submodule", "update", "-q", "--init", "--depth", "1");
  console.log(`${name}: ${commit}`);
}
