// Publishing a site made in this browser: a new GitHub repository (or an empty one the user made)
// with the site's files, the theme as a git submodule, and GitHub Pages turned on.
import { commitFiles } from "../repo/commit.ts";
import { api, githubFetch, GitHubError } from "../repo/github.ts";
import { getToken } from "../repo/token.ts";

export interface PublishTarget {
  owner: string;
  name: string;
  private: boolean;
  /** Push to a repository that already exists (made by hand, or chosen on purpose) */
  existing: boolean;
}

export interface PublishInput {
  title: string;
  /** Every file of the site as it is now (drafts applied), the theme's files left out */
  files: Map<string, Uint8Array>;
  themeDir: string;
  themeRepo: string;
  themeCommit: string;
}

export interface Published {
  fullName: string;
  branch: string;
  /** GitHub Pages was turned on (or already was) */
  pages: boolean;
  /** The deploy workflow couldn't be pushed (the token can't write workflows) */
  withoutWorkflow: boolean;
}

/** Thrown when the repository can't be created with this token: the user can make it on GitHub */
export class CreateRepoError extends Error {
  constructor(
    message: string,
    readonly newRepoUrl: string,
  ) {
    super(message);
  }
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const TEXT = /\.(md|markdown|toml|ya?ml|json|html?|css|scss|sass|js|mjs|ts|txt|xml|svg|gitignore|gitmodules)$|(^|\/)\.git(ignore|modules|attributes)$/i;

function asText(path: string, data: Uint8Array): string | Uint8Array {
  if (!TEXT.test(path)) return data;
  try {
    return decoder.decode(data);
  } catch {
    return data;
  }
}

function base64Text(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

export function newRepoUrl(target: Pick<PublishTarget, "owner" | "name" | "private">): string {
  const params = new URLSearchParams({ name: target.name, owner: target.owner, visibility: target.private ? "private" : "public" });
  return `https://github.com/new?${params}`;
}

async function createRepo(target: PublishTarget, title: string): Promise<void> {
  const login = getToken()?.login;
  const path = target.owner.toLowerCase() === login?.toLowerCase() ? "/user/repos" : `/orgs/${target.owner}/repos`;
  try {
    await api(path, {
      method: "POST",
      body: JSON.stringify({ name: target.name, private: target.private, auto_init: true, description: `${title}: a Zola site` }),
    });
  } catch (error) {
    if (error instanceof GitHubError && error.kind === "conflict") {
      throw new GitHubError(`${target.owner}/${target.name} already exists. Choose another name, or publish into it if it's yours and empty.`, "conflict");
    }
    if (error instanceof GitHubError && ["forbidden", "not-found", "unauthorized"].includes(error.kind)) {
      throw new CreateRepoError(
        "This token can't create repositories. Create the repository on GitHub (empty is fine), then publish into it, or use a token with Administration: Read and write.",
        newRepoUrl(target),
      );
    }
    throw error;
  }
}

/** The branch to commit to and its head, starting the history if the repository is empty */
async function head(fullName: string, title: string): Promise<{ branch: string; sha: string }> {
  const info = await api<{ default_branch: string }>(`/repos/${fullName}`);
  const branch = info.default_branch || "main";
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await githubFetch(`/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`).catch((error) => error as Error);
    if (!(response instanceof Error)) return { branch, sha: ((await response.json()) as { object: { sha: string } }).object.sha };
    if (!(response instanceof GitHubError) || !["conflict", "not-found"].includes(response.kind)) throw response;
    // An empty repository has no commits for the Git Data API to build on: start one
    if (attempt === 0) {
      await api(`/repos/${fullName}/contents/README.md`, {
        method: "PUT",
        body: JSON.stringify({ message: "Start the site", content: base64Text(`# ${title}\n`), branch }),
      }).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new GitHubError(`${fullName} has no ${branch} branch to publish to.`);
}

export async function publish(input: PublishInput, target: PublishTarget, onStep: (step: string) => void): Promise<Published> {
  const fullName = `${target.owner}/${target.name}`;
  if (!target.existing) {
    onStep(`Creating ${fullName}…`);
    await createRepo(target, input.title);
  }
  const { branch, sha } = await head(fullName, input.title);

  const files = new Map<string, string | Uint8Array | null>();
  for (const [path, data] of input.files) files.set(path, asText(path, data));
  const submodule = `themes/${input.themeDir}`;
  files.set(".gitmodules", `[submodule "${submodule}"]\n\tpath = ${submodule}\n\turl = ${input.themeRepo}.git\n`);
  const gitlinks = new Map([[submodule, input.themeCommit]]);
  const count = input.files.size;

  onStep(`Committing ${count} files to ${fullName}…`);
  let withoutWorkflow = false;
  try {
    await commitFiles({ fullName, branch, base: sha, files, gitlinks, message: `Create ${input.title} with zdrafts` });
  } catch (error) {
    // Pushing a workflow needs the token's workflow permission; publish without it rather than not at all
    if (!(error instanceof GitHubError) || !/workflow/i.test(error.message)) throw error;
    for (const path of [...files.keys()]) if (path.startsWith(".github/workflows/")) files.delete(path);
    withoutWorkflow = true;
    await commitFiles({ fullName, branch, base: sha, files, gitlinks, message: `Create ${input.title} with zdrafts` });
  }

  onStep("Turning on GitHub Pages…");
  let pages = false;
  try {
    await api(`/repos/${fullName}/pages`, { method: "POST", body: JSON.stringify({ build_type: "workflow" }) });
    pages = true;
  } catch (error) {
    // Already on is fine
    pages = error instanceof GitHubError && error.kind === "conflict";
  }
  return { fullName, branch, pages, withoutWorkflow };
}
