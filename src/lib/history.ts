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
  changeType: "added" | "modified" | "removed" | "moved";
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
   *  ≤8 chars letter-edit, "semantic" = real content change. Only set for
   *  `changeType: "modified"`. */
  changeKind?: "lint" | "typo" | "semantic";
  /** Source path for `changeType: "moved"` */
  movedFrom?: string;
  /** Destination path for `changeType: "moved"` */
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

/** Single source of truth for change-type → CSS color, shared by the atlas
 *  history panel (EntryRow) and the radar actor history (ActorHistory).
 *  added/removed reuse the diff-view tokens so the label color matches the
 *  diff body; modified/moved have no diff equivalent. */
export const CHANGE_COLOR: Record<string, string> = {
  added: "var(--diff-added-fg)",
  modified: "var(--tan-3)",
  removed: "var(--diff-removed-fg)",
  // Blue from the decorative depth cycle — deliberately NOT --accent (the link
  // color) nor --warn/--error-text (which carry their own meaning); it just has to
  // be distinct from added-green, removed-pink and modified-tan. 6.1:1 on --bg.
  moved: "var(--depth-4)",
};

// Shared shape for every /api/history/* GET below: a 404 (no backend on this
// deploy, or no such doc) is a stable outcome and IS cached; any other
// failure — a transient DB hiccup (503), a real fetch rejection — must NOT be
// cached as permanent "no data", so it evicts the cache entry via `onFail` and
// resolves to null for just this call. Callers never see a rejection.
function fetchCached<T>(url: string, label: string, onFail: () => void): Promise<T | null> {
  const p = fetch(url)
    .then((r) => {
      if (r.ok) return r.json() as Promise<T>;
      if (r.status === 404) return null;
      throw new Error(`${label} fetch failed with status ${r.status}`); // transient
    })
    .catch((err) => {
      onFail();
      throw err;
    });
  return p.catch(() => null);
}

// Module-level cache: nodeId → promise
const cache = new Map<string, Promise<HistoryEntry[] | null>>();

export function loadHistory(nodeId: string): Promise<HistoryEntry[] | null> {
  let p = cache.get(nodeId);
  if (!p) {
    // Mirrors loadHistoryBatch below, which already only seeds the cache on a
    // real response.
    p = fetchCached<HistoryEntry[]>(`/api/history/${nodeId}`, "history", () => cache.delete(nodeId));
    cache.set(nodeId, p);
  }
  return p;
}

/** One doc's strict-modification tally from GET /api/history/mod-counts —
 *  content edits only (no moves/renames/renumbers), and of those only semantic
 *  ones. Docs with no content history at all are absent from the response;
 *  the Modification Frequency report zero-fills them from docs.json. */
export interface ModCount {
  docId: string;
  /** Semantic content edits (the report's "modifications"). */
  count: number;
  /** YYYY-MM-DD of the latest counted edit; null when count is 0. */
  lastModified: string | null;
  /** All content rows incl. lint/typo/unclassified — context, not the metric. */
  contentCount: number;
}

let modCountsCache: Promise<ModCount[] | null> | null = null;

/** Fetch the all-docs modification tallies. Same contract as loadHistory. */
export function loadModCounts(): Promise<ModCount[] | null> {
  if (!modCountsCache) {
    modCountsCache = fetchCached<ModCount[]>("/api/history/mod-counts", "mod-counts", () => {
      modCountsCache = null;
    });
  }
  return modCountsCache;
}

export type TimelineGranularity = "month" | "week" | "commit";

/** One time bucket's semantic-edit tally from GET /api/history/mod-timeline
 *  (granularity=month|week). Periods with no matching edit are absent — the
 *  Modification Frequency report's timeline chart zero-fills the gaps
 *  client-side. */
export interface ModTimelinePeriodRow {
  /** "YYYY-MM" (month) or the Monday-start date of the week, "YYYY-MM-DD". */
  period: string;
  count: number;
}

/** One commit's semantic-edit tally from GET /api/history/mod-timeline
 *  (granularity=commit). No zero-fill — an absent commit touched no matching
 *  content, not a gap in a continuous axis. */
export interface ModTimelineCommitRow {
  seq: number;
  sha: string;
  /** null for a severed-era commit, which carries only a date window. */
  date: string | null;
  count: number;
}

// Cached per granularity (like loadGraph's per-base cache in ./graph.ts) —
// each mode is a genuinely different dataset, not a filtered view of one.
const modTimelineCache = new Map<
  TimelineGranularity,
  Promise<(ModTimelinePeriodRow | ModTimelineCommitRow)[] | null>
>();

/** Fetch the semantic-edits timeline at the given granularity. Same contract
 *  as loadModCounts, cached per granularity. Returns the row shape matching
 *  the requested granularity — narrow with the granularity value at the call
 *  site (see useModFrequencyTimeline). */
export function loadModTimeline(
  granularity: TimelineGranularity = "month",
): Promise<(ModTimelinePeriodRow | ModTimelineCommitRow)[] | null> {
  let p = modTimelineCache.get(granularity);
  if (!p) {
    p = fetchCached<(ModTimelinePeriodRow | ModTimelineCommitRow)[]>(
      `/api/history/mod-timeline?granularity=${granularity}`,
      "mod-timeline",
      () => modTimelineCache.delete(granularity),
    );
    modTimelineCache.set(granularity, p);
  }
  return p;
}

/** Max ids per /api/history/batch request — shared by the server (hard cap on
 *  a hostile payload) and the client (chunk size). Comfortably above the
 *  largest real actor doc-set (~1.2k for Spark). */
export const BATCH_MAX = 2000;

/** Fetch history for many docs in one round-trip via POST /api/history/batch,
 *  keyed by docId. Used by the radar actor view so it doesn't fan out into
 *  hundreds of per-doc `/api/history/:id` requests. Docs with no history map to
 *  `[]`. On a backend-less deploy (GitHub Pages) the fetch fails and every id
 *  resolves to `[]`, matching `loadHistory`'s graceful-null behaviour.
 *
 *  Successful responses also seed the per-doc `cache` so a later single-doc
 *  `loadHistory` (e.g. the atlas history panel) reuses the result. */
export async function loadHistoryBatch(nodeIds: string[]): Promise<Map<string, HistoryEntry[]>> {
  const ids = [...new Set(nodeIds)];
  const out = new Map<string, HistoryEntry[]>();
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const chunk = ids.slice(i, i + BATCH_MAX);
    let data: Record<string, HistoryEntry[]> | null = null;
    try {
      const r = await fetch("/api/history/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: chunk }),
      });
      data = r.ok ? ((await r.json()) as Record<string, HistoryEntry[]>) : null;
    } catch {
      data = null;
    }
    for (const id of chunk) {
      if (data) {
        const entries = data[id] ?? [];
        out.set(id, entries);
        // Seed the single-doc cache (only on a real response, so a transient
        // failure doesn't poison it with empties).
        if (!cache.has(id)) cache.set(id, Promise.resolve(entries.length ? entries : null));
      } else {
        out.set(id, []);
      }
    }
  }
  return out;
}
