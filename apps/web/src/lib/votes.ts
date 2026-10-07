import { fetchJson } from "@/lib/verify";
import type { VoteEvidenceOverlay } from "@/lib/votes/overlay";
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

let overlay: Promise<VoteEvidenceOverlay | null> | null = null;

/**
 * The atlas worker's refined vote evidence (GET /api/vote-evidence), laid over
 * the rules' verdicts by applyOverlay. Root-relative like /api/chain-state: an
 * API route, not a BASE_URL asset. Null until the worker has run, or when the
 * API is unreachable; the page then shows the rules' verdicts.
 */
export function loadVoteEvidence(): Promise<VoteEvidenceOverlay | null> {
  if (!overlay) {
    overlay = fetchJson<VoteEvidenceOverlay>("/api/vote-evidence", "vote-evidence").catch(() => {
      overlay = null;
      return null;
    });
  }
  return overlay;
}

/** Test-only: drop the memoised fetches so the next load hits the network again. */
export function resetVoteIndexCache(): void {
  cached = null;
  overlay = null;
}
