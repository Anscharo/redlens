// The vote record (votes.json, from `pnpm votes:sync`) for server-side report
// tools, indexed for matching. The same artifact the browser fetches from
// BASE_URL; not atlas-SHA keyed.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { VotesArtifact } from "../lib/votes/types.ts";
import { buildVoteIndex, type VoteIndex } from "../lib/votes/vote-index.ts";
import { config } from "./config.ts";

const ROOT = resolve(import.meta.dir, "../..");

let cached: { key: string; index: VoteIndex | null } | null = null;

// Dev's refreshed copy first, then the one baked into the image.
const CANDIDATES = [resolve(ROOT, "public/votes.json"), resolve(config.distDir, "votes.json")];

/**
 * The indexed vote record, or null when there is none or it does not parse:
 * report tools then answer without vote evidence rather than failing. Reloads
 * when the file's path or mtime changes, since dev re-syncs it under a
 * running server; report tools build synchronously, so this reads synchronously.
 */
export function loadVoteIndexFromDisk(candidates: readonly string[] = CANDIDATES): VoteIndex | null {
  const path = candidates.find((p) => existsSync(p)) ?? null;
  const key = path ? `${path}@${statSync(path).mtimeMs}` : "";
  if (cached?.key === key) return cached.index;
  let index: VoteIndex | null = null;
  if (path) {
    try {
      index = buildVoteIndex(JSON.parse(readFileSync(path, "utf8")) as VotesArtifact);
    } catch {
      index = null;
    }
  }
  cached = { key, index };
  return index;
}
