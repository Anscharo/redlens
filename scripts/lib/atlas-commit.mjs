// Shared atlas SHA stamping. The runtime image has no git and no atlas
// checkout, so build-graph must inherit the SHA already written into docs.json
// (the updater stamps sync_state.atlas_sha there) instead of falling through
// to `git rev-parse` → "unknown". That "unknown" sentinel is truthy, so
// /api/health reports live !== db forever and E2E never sees a ready deploy.

import { execSync } from "node:child_process";

/** Fallback stamp when env, docs.json, and git all fail. */
export const UNKNOWN_ATLAS_COMMIT = "unknown";

export function isUsableAtlasCommit(value) {
  return typeof value === "string" && value.length > 0 && value !== UNKNOWN_ATLAS_COMMIT;
}

/** First usable SHA among candidates; null if none. */
export function pickAtlasCommit(...candidates) {
  for (const c of candidates) {
    if (isUsableAtlasCommit(c)) return c;
  }
  return null;
}

/** Same as pickAtlasCommit, but the JSON-envelope fallback is "unknown". */
export function stampAtlasCommit(...candidates) {
  return pickAtlasCommit(...candidates) ?? UNKNOWN_ATLAS_COMMIT;
}

export function gitHead(cwd) {
  try {
    const sha = execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}
