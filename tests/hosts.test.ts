import { expect, test } from "vitest";
import { parseGitmodules } from "../src/repo/github.ts";
import { parseRemote } from "../src/repo/hosts.ts";

test("git remotes on known hosts", () => {
  expect(parseRemote("https://github.com/gauthamchettiar/zola-yolk.git")).toEqual({ host: "github", origin: "https://github.com", path: "gauthamchettiar/zola-yolk", url: "https://github.com/gauthamchettiar/zola-yolk" });
  expect(parseRemote("git@github.com:a/b.git")?.path).toBe("a/b");
  expect(parseRemote("https://codeberg.org/daudix/duckquill")?.host).toBe("gitea");
  expect(parseRemote("ssh://git@codeberg.org/daudix/duckquill.git")?.url).toBe("https://codeberg.org/daudix/duckquill");
  expect(parseRemote("https://gitlab.com/group/sub/theme.git")).toMatchObject({ host: "gitlab", path: "group/sub/theme" });
  expect(parseRemote("not a url")).toBeNull();
});

test(".gitmodules, relative URLs included", () => {
  const text = '[submodule "themes/a"]\n\tpath = themes/a\n\turl = https://codeberg.org/x/a.git\n[submodule "themes/b"]\n\tpath = themes/b\n\turl = ../b.git\n';
  const modules = parseGitmodules(text, "me");
  expect(modules.get("themes/a")?.host).toBe("gitea");
  expect(modules.get("themes/b")).toMatchObject({ host: "github", path: "me/b" });
});
