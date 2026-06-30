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
   *  cross-check + human review) — so the diff is approximate. Absent for the
   *  native markdown era. Drives the reconstruction disclaimer in the history panel. */
  era?: string;
  /** Per-change provenance for an HTML-era entry: how this document's lineage link
   *  was traced. Only the exceptions are recorded — "ai" (an LLM/frontier auto-lock)
   *  or "human" (a person's confirmed pick); deterministically-matched links are absent
   *  ("deterministic" implied). Drives the AI / human badge on the entry. */
  method?: "deterministic" | "ai" | "human";
}

/** Single source of truth for change-type → CSS color, shared by the atlas
 *  history panel (EntryRow) and the radar actor history (ActorHistory).
 *  added/removed reuse the diff-view tokens so the label color matches the
 *  diff body; modified/moved have no diff equivalent. */
export const CHANGE_COLOR: Record<string, string> = {
  added: "var(--diff-added-fg)",
  modified: "var(--tan-3)",
  removed: "var(--diff-removed-fg)",
  moved: "var(--accent)",
};

// Module-level cache: nodeId → promise
const cache = new Map<string, Promise<HistoryEntry[] | null>>();

export function loadHistory(nodeId: string): Promise<HistoryEntry[] | null> {
  let p = cache.get(nodeId);
  if (!p) {
    // /api/history/:nodeId — absolute path, same-origin on Railway.
    // On GitHub Pages (no backend) the 404 resolves to null, which the UI
    // already handles gracefully.
    p = fetch(`/api/history/${nodeId}`)
      .then((r) => (r.ok ? (r.json() as Promise<HistoryEntry[]>) : null))
      .catch(() => null);
    cache.set(nodeId, p);
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
