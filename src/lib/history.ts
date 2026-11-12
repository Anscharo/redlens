import type { ChangeType } from "./changeTypes";

/** Word-level segment within an intraline diff */
export type WordSegment = ["=" | "+" | "-", string];

/** Single diff line:
 *  ["="|"+"|"-", text]  — unchanged / added / removed line
 *  ["~", segments]       — modified line with intraline word diff
 *  ["…"]                 — gap between context hunks
 */
export type DiffLine = ["=" | "+" | "-", string] | ["~", WordSegment[]] | ["…"];

export interface HistoryEntry {
  date: string;
  commitHash: string;
  /** `modified`: the body changed. `retitled`: the title changed. `renumbered`:
   *  the doc number changed. `retyped`: the heading's `[Type]` changed. */
  changeType: ChangeType;
  pr?: number;
  prTitle?: string;
  prAuthor?: string;
  prUrl?: string;
  reviewCount?: number;
  approvalCount?: number;
  commentCount?: number;
  /** Matched PR body bullet title, if any */
  summary?: string;
  /** Matched PR body bullet description, if any */
  description?: string;
  /** Per-node line diff */
  diff?: DiffLine[];
  /** Significance of a modified edit: "lint" = whitespace-only, "typo" =
   *  ≤4 alphanumeric chars changed with no run over 2, "semantic" = real
   *  content change (scripts/lib/history-classify.mjs is the implementation —
   *  it is stricter than "≤8 chars", which this comment used to claim). Only set for
   *  `changeType: "modified"`. */
  changeKind?: "lint" | "typo" | "semantic";
  /** The value before: the source path of a `moved` entry, the old title of a
   *  `retitled` one, the old doc number of a `renumbered` one, the old type of a
   *  `retyped` one. */
  movedFrom?: string;
  /** The value after, for the same four change types. */
  movedTo?: string;
  /** Reconstruction era. "html" = a pre-#117 entry auto-translated from the
   *  original HTML tables, with lineage traced (deterministic matching + AI
   *  cross-check + human review) — so the diff is approximate. "mip" / "genesis" /
   *  "severed" = pre-git origin events (docs/plans/pre-git-history.md): a doc's
   *  verbiage traced to the MIP-era Atlas, its presence in the recovered Atlas v2
   *  genesis snapshot, or an undated birth somewhere in the severed (git-less)
   *  window. Absent for the native markdown era. Drives the reconstruction
   *  disclaimer in the history panel. */
  era?: string;
  /** Per-change provenance for a reconstructed-era entry: how this document's lineage
   *  link was traced. Only the exceptions are recorded — "ai" (an LLM/frontier
   *  auto-lock) or "human" (a person's confirmed pick); deterministically-matched
   *  links are absent ("deterministic" implied). Drives the AI / human badge. */
  method?: "deterministic" | "ai" | "human";
  /** Baked ordering position for a pre-git origin event (era mip/genesis/severed) —
   *  the reserved negative commit_seq block. Absent for git-derived eras, which order
   *  by their real git-log position instead. NodeHistory sorts on this, not on `date`
   *  (severed-interval births carry no date at all). */
  commitSeq?: number;
  /** External reference for a pre-git origin event: the mips-repo section on GitHub,
   *  or the genesis IPFS gateway URL. Absent for git-derived eras (those link their
   *  real commit instead). */
  sourceUrl?: string;
  /** How this document crossed the HTML→markdown seam (scripts/htmlhist/). On an
   *  html-era `added` row it labels the doc's birth; on the #117 `moved` row it is the
   *  reconstruction's verdict for the doc as a whole:
   *   · "kept"/"split"/"merged"/"reintroduced" — lineage traced, pre-#117 entries exist;
   *   · "untraced" — no pre-migration entry could be matched to it. NOT a claim that the
   *     doc was created at the migration; its earlier history is simply unknown;
   *   · "created" — a reviewed verdict that the pre-migration HTML holds no earlier
   *     version (public/history-decisions.json). */
  seam?: string;
  /** The spells this change belongs to, as YYYY-MM-DD: the ones its PR bullet or its pull request names (src/lib/atlasPrSpell.ts). Empty: it names none. Absent: its PR record is not read yet, or the server predates it. */
  spells?: string[];
}

/** Reconstructed (non-git-native) history eras — every era whose entries carry a
 *  synthetic (non-git) commit_sha and need the toggle/disclaimer treatment, as
 *  opposed to a real markdown-era commit. */
export const RECONSTRUCTED_ERAS = new Set(["html", "mip", "genesis", "severed"]);

/** The atlas repo every commit / PR link points at. */
export const ATLAS_REPO = "https://github.com/sky-ecosystem/next-gen-atlas";

/** URL of an entry's Atlas PR. Reconstructed (HTML-era) rows carry a PR number but
 *  no stored `pr_url` — those PRs predate the `atlas_prs` metadata the git-era rows
 *  get their URL from — so derive it from the number rather than rendering a dead
 *  <a> with no href. */
export function prHref(e: { pr?: number; prUrl?: string }): string | undefined {
  return e.prUrl ?? (e.pr ? `${ATLAS_REPO}/pull/${e.pr}` : undefined);
}

/** A real git commit sha (7–40 lowercase hex), as opposed to a synthetic pre-git tag
 *  (`mip:104:14.3`, `genesis:bafkreih7…`, `severed:…`). Gates the "view on GitHub"
 *  commit link, which is meaningless for a synthetic tag. */
export function isGitSha(s: string | undefined | null): boolean {
  return !!s && /^[0-9a-f]{7,40}$/i.test(s);
}

/** 'Migrate To Markdown File' (2025-11-21) — the PR that turned the single HTML
 *  atlas into markdown. Every doc alive at the time carries a `moved` row for it. */
export const PRE_MD_PR = 117;
// git records that migration as a whole-file rewrite rather than a rename, so the
// per-doc rows carry no paths — name the one path every doc took instead.
const PRE_MD_MOVE = { from: "Sky Atlas.html", to: "Sky Atlas.md" } as const;

/** A severed-era birth has no date — only the window it happened in, encoded in
 *  its synthetic tag (`severed:2024-09-02..2025-05-28`). Render that window as a
 *  month range so the entry still carries a when. Null if it isn't one. */
export function severedRange(commitHash: string): string | null {
  const m = /^severed:(\d{4}-\d{2})-\d{2}\.\.(\d{4}-\d{2})-\d{2}$/.exec(commitHash);
  return m && `${m[1]} ~ ${m[2]}`;
}

/** The from/to paths to render for a `moved` entry, or null if it isn't a move
 *  (or is one with no paths to show — including a self-move, see below). */
export function movePaths(e: HistoryEntry): { from?: string; to: string } | null {
  if (e.changeType !== "moved") return null;
  // Self-move: movedFrom and movedTo are identical. The html-era generator
  // (history-html-era.mjs) used to fire `moved` and stamp both with the same
  // doc_no whenever only a doc's title/ancestors changed (doc_no itself did
  // not) — rendering a nonsense "moved from X to X" (335 frozen rows, deep-QA
  // H2). Treat it as having nothing to show, same as any other pathless move.
  if (e.movedTo && e.movedTo === e.movedFrom) return null;
  if (e.movedTo) return { from: e.movedFrom, to: e.movedTo };
  return e.pr === PRE_MD_PR ? PRE_MD_MOVE : null;
}

/** Change-type → CSS colour (src/lib/changeTypes.ts), shared by the atlas
 *  history panel and the radar actor history. */
export { CHANGE_COLOR } from "./changeTypes";

/** `content/A/1/9/document.md` holds doc A.1.9: in the atomized layout a path
 *  spells out its document's number. */
const numberInPath = (path: string, docNo: string) => path.includes(`/${docNo.split(".").join("/")}/`);

/** A `moved` entry that only restates a same-commit renumbering: in the
 *  atomized layout a document's path spelled out its number, so every
 *  renumbering of that era also moved its file. */
function restatesRenumber(e: HistoryEntry, r: HistoryEntry | undefined): boolean {
  if (e.changeType !== "moved" || !r?.movedFrom || !r.movedTo || !e.movedFrom || !e.movedTo) return false;
  return numberInPath(e.movedFrom, r.movedFrom) && numberInPath(e.movedTo, r.movedTo);
}

/** Drop the entries a more specific same-commit entry says better: a file move
 *  that only restates a renumbering, and an edit with no diff beside a
 *  retitling, which records nothing the retitling does not. A move between
 *  files that is more than a renumbering, and any edit with a diff, stay. */
export function foldRestatedEntries(entries: HistoryEntry[]): HistoryEntry[] {
  const by = (type: ChangeType) => new Map(entries.filter((e) => e.changeType === type).map((e) => [e.commitHash, e]));
  const renumbers = by("renumbered");
  const retitles = by("retitled");
  return entries.filter(
    (e) =>
      !restatesRenumber(e, renumbers.get(e.commitHash)) &&
      !(e.changeType === "modified" && !e.diff?.length && retitles.has(e.commitHash)),
  );
}

export {
  BATCH_MAX,
  loadHistory,
  loadHistoryBatch,
  loadModCounts,
  loadModTimeline,
} from "./history-load.ts";
export type { ModCount, ModTimelineCommitRow, ModTimelinePeriodRow, TimelineGranularity } from "./history-load.ts";
