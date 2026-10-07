import { fetchJson } from "@/lib/verify";
import type { VotesArtifact } from "@/lib/votes/types";
import { buildVoteIndex, type VoteIndex } from "@/lib/votes/vote-index";

// Browser loader for the baked votes.json artifact (`pnpm votes:sync`), indexed
// for matching. Server chat/MCP reads the same file from disk (src/server/votes.ts).
// Resolves null when the file is missing or unreadable: the vote record is an
// extra column on Stale Dates, never a reason to fail the page.

let cached: Promise<VoteIndex | null> | null = null;

export function loadVoteIndex(): Promise<VoteIndex | null> {
  if (!cached) {
    cached = fetchJson<VotesArtifact>(`${import.meta.env.BASE_URL}votes.json`, "votes.json")
      .then(buildVoteIndex)
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return cached;
}

/** Test-only: drop the memoised fetch so the next loadVoteIndex() hits the network again. */
export function resetVoteIndexCache(): void {
  cached = null;
}
