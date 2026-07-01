import type { AtlasNode } from "../types";
import type { AtlasBundle } from "./docs";
import type { GraphData } from "./graph";
import { buildAncestors } from "./atlasHelpers";

// Properties attached to a `doc_view` event. All UUIDs / enums / public titles —
// no PII. `node_id` (UUID) is the stable identity; `doc_no` is a human label only.
// scope_* answers "which scope is popular"; entity_* answers "which agent's docs
// are read disproportionately"; ancestor_ids enables co-viewing/cluster analysis.
export interface DocViewProps {
  node_id: string;
  doc_no: string;
  title: string;
  doc_type: string;
  depth: number;
  scope_id: string | null;
  scope_title: string | null;
  ancestor_ids: string[];
  // Denominators for normalised popularity: views/scope_total_docs gives
  // views-per-doc (so big scopes don't look popular just for being big);
  // atlas_total_docs and doc_type_total enable share-of-views vs share-of-docs.
  scope_total_docs: number | null;
  doc_type_total: number;
  atlas_total_docs: number;
  entity_slug?: string;
  entity_type?: string;
  [key: string]: unknown;
}

// Scope = the top-level node, addressed by the first two doc_no segments ("A.1").
function scopeDocNo(docNo: string): string {
  return docNo.split(".").slice(0, 2).join(".");
}

interface AtlasCounts {
  byScope: Map<string, number>; // scope_id → docs in that scope
  byType: Map<string, number>; // doc type → docs of that type (whole atlas)
  scopedTotal: number; // total docs that belong to a scope (excludes NR-*)
}

// Counting every doc on each view would be O(n) per event; cache per bundle. The
// bundle object is stable (module-level promise cache in docs.ts), so the WeakMap
// recomputes only when a new atlas bundle loads.
const countsCache = new WeakMap<AtlasBundle, AtlasCounts>();

function atlasCounts(atlas: AtlasBundle): AtlasCounts {
  const cached = countsCache.get(atlas);
  if (cached) return cached;
  const byScope = new Map<string, number>();
  const byType = new Map<string, number>();
  let scopedTotal = 0;
  for (const node of Object.values(atlas.docs)) {
    byType.set(node.type, (byType.get(node.type) ?? 0) + 1);
    if (node.doc_no.startsWith("NR-")) continue; // Needed Research has no scope
    const sid = atlas.docNoToId.get(scopeDocNo(node.doc_no));
    if (sid) {
      byScope.set(sid, (byScope.get(sid) ?? 0) + 1);
      scopedTotal++;
    }
  }
  const counts: AtlasCounts = { byScope, byType, scopedTotal };
  countsCache.set(atlas, counts);
  return counts;
}

export function buildDocViewProps(
  atlas: AtlasBundle,
  nodeId: string,
  graph: GraphData | null,
): DocViewProps | null {
  const node: AtlasNode | undefined = atlas.docs[nodeId];
  if (!node) return null;

  const scopeId = node.doc_no.startsWith("NR-")
    ? null
    : atlas.docNoToId.get(scopeDocNo(node.doc_no)) ?? null;
  const scope = scopeId ? atlas.docs[scopeId] : null;
  const ancestors = buildAncestors(atlas.docs, atlas.docNoToId, nodeId);

  // Entity enrichment (best-effort): a participant whose defining doc is this node.
  const entity = graph?.participants.find((p) => p.did === nodeId) ?? null;

  const counts = atlasCounts(atlas);

  return {
    node_id: node.id,
    doc_no: node.doc_no,
    title: node.title,
    doc_type: node.type,
    depth: node.depth,
    scope_id: scopeId,
    scope_title: scope?.title ?? null,
    ancestor_ids: ancestors.map((a) => a.id),
    scope_total_docs: scopeId ? counts.byScope.get(scopeId) ?? null : null,
    doc_type_total: counts.byType.get(node.type) ?? 0,
    atlas_total_docs: counts.scopedTotal,
    ...(entity ? { entity_slug: entity.slug, entity_type: entity.et } : {}),
  };
}
