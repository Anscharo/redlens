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
}

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
    cache.set(nodeId, p!);
  }
  return p;
}
