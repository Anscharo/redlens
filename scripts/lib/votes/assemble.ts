// Assembly rules for public/votes.json: joining the portal onto the parsed
// repositories, the floors that reject a truncated fetch, and the shrink guard.
// Pure: no I/O.

import type { PortalData } from "./portal.ts";
import type { Executive, Poll, VotesArtifact } from "./types.ts";

// Floors sit well under the corpus size so a quiet month never trips them;
// they catch an empty or truncated fetch, which otherwise parses cleanly.
export const MIN_EXECUTIVES = 25;
export const MIN_POLLS = 100;
// A deployed executive missing from the portal is the exception, so more than
// this many means the portal's executive list was cut short.
export const MAX_EXECUTIVES_WITHOUT_PORTAL = 2;

export interface JoinStats {
  executivesWithoutPortal: string[];
  portalExecutivesWithoutFile: number;
  pollsWithoutPortal: string[];
  portalPollsWithoutFile: number;
  portalDuplicates: string[];
}

/**
 * Sets `portal` on every executive (joined by spell address) and poll (joined
 * by file path). Unmatched rows on either side are reported, not fatal: the
 * repository and the portal update independently.
 */
export function attachPortal(executives: Executive[], polls: Poll[], portal: PortalData): JoinStats {
  for (const e of executives) {
    e.portal = e.address ? (portal.executivesByAddress.get(e.address.toLowerCase()) ?? null) : null;
  }
  for (const p of polls) p.portal = portal.pollsByPath.get(pollRepoPath(p.file)) ?? null;
  const matchedE = executives.filter((e) => e.portal).length;
  const matchedP = polls.filter((p) => p.portal).length;
  return {
    // A drafted executive has no spell yet, so the portal cannot know it; only
    // a deployed spell missing from the portal is worth reporting.
    executivesWithoutPortal: executives.filter((e) => e.address && !e.portal).map((e) => e.file),
    portalExecutivesWithoutFile: portal.executivesByAddress.size - matchedE,
    pollsWithoutPortal: polls.filter((p) => !p.portal).map((p) => p.file),
    portalPollsWithoutFile: portal.pollsByPath.size - matchedP,
    portalDuplicates: portal.duplicates,
  };
}

/** Throws when too many deployed executives found no portal row: the portal list was truncated. */
export function checkPortalJoin(join: JoinStats): void {
  const missing = join.executivesWithoutPortal;
  if (missing.length > MAX_EXECUTIVES_WITHOUT_PORTAL) {
    throw new Error(
      `votes: ${missing.length} deployed executives have no portal row (limit ${MAX_EXECUTIVES_WITHOUT_PORTAL}), ` +
        `starting ${missing.slice(0, 3).join(", ")}. Refusing: the portal's executive list looks truncated.`,
    );
  }
}

// The portal keys a poll by "<year>/<file>.md"; the tree walk records the same path.
function pollRepoPath(file: string): string {
  return file.split("/").slice(-2).join("/");
}

export function checkFloors(a: VotesArtifact): void {
  if (a.executives.length < MIN_EXECUTIVES || a.polls.length < MIN_POLLS) {
    throw new Error(
      `votes: read ${a.executives.length} executives and ${a.polls.length} polls, under the floor ` +
        `(${MIN_EXECUTIVES} / ${MIN_POLLS}). Refusing: a truncated fetch parses cleanly and looks like a small one.`,
    );
  }
}

/**
 * What `next` lost against `prev`, or null when it lost nothing. The vote
 * record only grows, and portal coverage only grows with it, so a smaller
 * artifact — or one where fewer documents carry portal data — means a broken
 * fetch or a portal outage, not a real change.
 */
export function shrinkage(prev: VotesArtifact | null, next: VotesArtifact): string | null {
  if (!prev) return null;
  const measures: Array<[string, (a: VotesArtifact) => number]> = [
    ["executives", (a) => a.executives.length],
    ["polls", (a) => a.polls.length],
    ["executives with portal data", (a) => a.executives.filter((e) => e.portal).length],
    ["polls with portal data", (a) => a.polls.filter((p) => p.portal).length],
  ];
  const lost = measures
    .filter(([, n]) => n(next) < n(prev))
    .map(([label, n]) => `${label} ${n(prev)} → ${n(next)}`);
  return lost.length ? `the vote record shrank (${lost.join(", ")})` : null;
}

/**
 * Sort key for both arrays: filename date, then path. Code-point order, not
 * localeCompare, so the artifact is byte-identical whatever ICU data the
 * runtime ships.
 */
export function byDateThenFile<T extends { date: string; file: string }>(a: T, b: T): number {
  return codePointCompare(a.date, b.date) || codePointCompare(a.file, b.file);
}

function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
