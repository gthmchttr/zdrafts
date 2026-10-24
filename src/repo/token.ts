// The GitHub token: for private repositories, a higher API limit and committing.
//
// It's kept in localStorage when the user chooses to remember it, otherwise in sessionStorage
// (until the tab closes). Either way, any script running on this origin can read it: zdrafts' own
// code and the site's pages shown in the editor (whose third-party scripts the service worker's
// Content-Security-Policy blocks, see public/sw.js). A fine-grained token limited to the site's
// repository and "Contents" access keeps what it can do small.

export interface StoredToken {
  token: string;
  /** The GitHub user it belongs to */
  login: string;
}

const KEY = "zdrafts.github-token";
const listeners = new Set<() => void>();

function storages(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(localStorage, sessionStorage);
  } catch {
    // Storage blocked: the token lasts until the page closes
  }
  return out;
}

let memory: StoredToken | null = null;

export function getToken(): StoredToken | null {
  if (memory) return memory;
  for (const storage of storages()) {
    try {
      const value = storage.getItem(KEY);
      if (value) return (memory = JSON.parse(value) as StoredToken);
    } catch {
      // Unreadable: treat as no token
    }
  }
  return null;
}

export function setToken(token: StoredToken, remember: boolean) {
  forgetToken(false);
  memory = token;
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(token));
  } catch {
    // Kept in memory only
  }
  emit();
}

export function forgetToken(notify = true) {
  memory = null;
  for (const storage of storages()) {
    try {
      storage.removeItem(KEY);
    } catch {
      // Nothing stored
    }
  }
  if (notify) emit();
}

export function onTokenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

/** GitHub's form for a new fine-grained token, filled in with what zdrafts needs */
export function newTokenUrl(owner?: string): string {
  const params = new URLSearchParams({
    name: "zdrafts",
    description: "Edit and commit Zola site content from zdrafts",
    expires_in: "90",
    contents: "write",
  });
  if (owner) params.set("target_name", owner);
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}
