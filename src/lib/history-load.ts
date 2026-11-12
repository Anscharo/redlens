import type { HistoryEntry } from "./history.ts";

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
  for (let i = 0; i < ids.length; i += BATCH_MAX) await readBatchChunk(ids.slice(i, i + BATCH_MAX), out);
  return out;
}

async function readBatchChunk(chunk: string[], out: Map<string, HistoryEntry[]>) {
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
  storeBatchChunk(chunk, data, out);
}

function storeBatchChunk(chunk: string[], data: Record<string, HistoryEntry[]> | null, out: Map<string, HistoryEntry[]>) {
  for (const id of chunk) {
    if (!data) {
      out.set(id, []);
      continue;
    }
    const entries = data[id] ?? [];
    out.set(id, entries);
    if (!cache.has(id)) cache.set(id, Promise.resolve(entries.length ? entries : null));
  }
}
