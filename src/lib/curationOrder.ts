// Pure ordering / grouping / auto-select logic for the HTML-era curation tool.
// Kept out of the React components so it is unit-testable and the components stay
// thin (CLAUDE.md file-size rule). Three concerns:
//   1. commit-major ordering — finish every change in one commit before the one
//      before it (newest commit first, matching the backward thread's direction).
//   2. within-commit grouping — the "other changes in this commit" strip + ↑/↓ nav.
//   3. auto-select — when the LLM and a >95%-confidence candidate name the SAME
//      older doc, the case is safe to accept without a human keystroke.
import type { CurationCase, CurationData, Proposal } from "./historyCuration";

// A candidate at/above this matcher score is "confident"; combined with an LLM
// vote for the same doc, the pairing auto-resolves (user's bar).
export const AUTO_SELECT_THRESHOLD = 0.95;

// Newest-first rank for a commit sha. The #117 migration (the seed boundary) is
// newer than every HTML commit and is NOT in data.commits, so it ranks -1 (first).
export function commitRanker(data: CurationData): (sha: string) => number {
  const oldestFirst = new Map(data.commits.map((c, i) => [c.sha, i]));
  const n = data.commits.length;
  return (sha) => {
    const i = oldestFirst.get(sha);
    return i === undefined ? -1 : n - 1 - i; // newest HTML commit → 0; seed → -1
  };
}

// Cases ordered commit-major (newest commit first), then by document order within
// a commit. Stable on the original array index so older artifacts without
// subjectOrder still sort deterministically. `kind` filters but preserves order.
export function orderedCases(data: CurationData, kind = "all"): CurationCase[] {
  const rank = commitRanker(data);
  const stable = new Map(data.cases.map((c, i) => [c, i] as const));
  return data.cases
    .filter((c) => kind === "all" || c.kind === kind)
    .slice()
    .sort((a, b) => {
      const r = rank(a.newerSha) - rank(b.newerSha);
      if (r) return r;
      const o = (a.subjectOrder ?? stable.get(a)!) - (b.subjectOrder ?? stable.get(b)!);
      return o || stable.get(a)! - stable.get(b)!;
    });
}

// The contiguous run of cases sharing `index`'s commit (the ordered queue is
// commit-major, so a commit's cases are always adjacent). Returns inclusive start
// and exclusive end into `queue`.
export function commitBounds(queue: CurationCase[], index: number): { start: number; end: number } {
  if (!queue.length) return { start: 0, end: 0 };
  const sha = queue[index].newerSha;
  let start = index, end = index + 1;
  while (start > 0 && queue[start - 1].newerSha === sha) start--;
  while (end < queue.length && queue[end].newerSha === sha) end++;
  return { start, end };
}

// First index of the previous / next commit group relative to `index` (for ←/→
// commit jumps). Returns null at the ends.
export function adjacentCommit(queue: CurationCase[], index: number, dir: -1 | 1): number | null {
  const { start, end } = commitBounds(queue, index);
  if (dir < 0) {
    if (start === 0) return null;
    return commitBounds(queue, start - 1).start; // first case of the previous commit
  }
  return end < queue.length ? end : null; // first case of the next commit
}

// Human-readable commit label for the strip header.
export function commitInfo(data: CurationData, sha: string): { sha: string; date: string | null; pr: number | null; isSeed: boolean } {
  const c = data.commits.find((x) => x.sha === sha);
  const isSeed = !c; // not an HTML commit → the #117 markdown migration boundary
  return { sha, date: c?.date ?? null, pr: c?.pr ?? null, isSeed };
}

// The older-doc key to auto-select, or null. Fires only when the LLM's pick is a
// real candidate (not "none") whose matcher score clears AUTO_SELECT_THRESHOLD —
// i.e. independent agreement between the LLM and a >95%-confidence content match.
export function autoSelectKey(kase: CurationCase, proposal: Proposal | null | undefined): string | null {
  if (!proposal || proposal.chosenKey === "none") return null;
  const cand = kase.candidates.find((c) => c.key === proposal.chosenKey);
  return cand && cand.score > AUTO_SELECT_THRESHOLD ? cand.key : null;
}

// One x-axis column for the curation timeline chart: a commit (or the #117 seed seam)
// with its decision count broken down by kind. Columns are chronological — every HTML
// commit oldest→newest, then the migration seam (where all seed-close cases live) at the
// far right (newest). Commits with no decisions are kept so the clustering is visible.
export interface CommitColumn {
  sha: string;
  date: string | null;
  pr: number | null;
  counts: Record<string, number>;
  total: number;
  isSeam: boolean;
}
export function commitColumns(data: CurationData): CommitColumn[] {
  const byCommit = new Map<string, Record<string, number>>();
  for (const c of data.cases) {
    const m = byCommit.get(c.newerSha) ?? {};
    m[c.kind] = (m[c.kind] ?? 0) + 1;
    byCommit.set(c.newerSha, m);
  }
  const seam = data.meta.migrationSha as string | undefined;
  const shas = [...data.commits.map((c) => c.sha), ...(seam ? [seam] : [])];
  return shas.map((sha) => {
    const counts = byCommit.get(sha) ?? {};
    const meta = data.commits.find((c) => c.sha === sha);
    return {
      sha, date: meta?.date ?? null, pr: meta?.pr ?? null, counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      isSeam: sha === seam,
    };
  });
}

// Human-readable badge for HOW a case was auto-resolved (offline baseline or in-session
// LLM+95 agreement) — surfaced on the Confirm button so nothing is silently decided.
export function autoLabel(via: string | undefined): string {
  if (via === "forward-reverse") return "Auto-resolved (forward + reverse agree)";
  if (via === "containment") return "Auto-resolved (reverse + containment agree)";
  if (via === "llm-90") return "Auto-resolved (LLM + 90% matcher agree)";
  if (via === "llm-95") return "Auto-resolved (LLM + 95% agree)";
  return "Auto-resolved";
}
