import { readJson, writeJson } from "./safeStorage";

const ACCESS_DISMISS_KEY = "sabr-preview-access-dismissed";

/** Repos whose ACCESS notice this browser has dismissed. localStorage, so it
 *  survives reloads on this machine. */
export function readDismissedAccessRepos(): Set<string> {
  const parsed = readJson<{ repos?: unknown }>(ACCESS_DISMISS_KEY);
  if (!Array.isArray(parsed?.repos)) return new Set();
  return new Set(parsed.repos.filter((r): r is string => typeof r === "string"));
}

/** Persists the dismissal. A failed write (private mode, quota) leaves the
 *  in-memory hide in effect for this view. */
export function dismissAccessRepo(repo: string): void {
  const repos = readDismissedAccessRepos();
  repos.add(repo);
  writeJson(ACCESS_DISMISS_KEY, { v: 1, repos: [...repos] });
}
