// DOM-free atlas bundle shape. Extracted from docs.ts — which imports the
// browser-coupled atlas worker / atlasBase layer — so server-side report
// builders can import AtlasBundle without pulling the DOM into the server
// tsconfig. docs.ts re-exports it for existing frontend callers.
import type { AtlasNode } from "../types";

export interface AtlasBundle {
  docs: Record<string, AtlasNode>;
  /** parentId → children sorted by `order`. Root nodes are keyed by `null`. */
  byParent: Map<string | null, AtlasNode[]>;
  /** doc_no → node id (for doc_no-based lookups) */
  docNoToId: Map<string, string>;
  atlasCommit: string | null;
}
