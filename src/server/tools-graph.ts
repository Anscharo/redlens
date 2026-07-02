// Graph-traversal and structural-filter tools that run entirely in-memory.
// No DB access — all data comes from the Indexes (docs, entities, edges).
import { type Indexes, resolveNode, descendantIds, type AtlasNode, type Entity } from "./indexes.ts";
import { type ToolResult } from "./tools.ts";

// Slim node row for tool responses.
function docRow(n: AtlasNode) {
  return { id: n.id, doc_no: n.doc_no, title: n.title, type: n.type, depth: n.depth };
}
function entityRow(e: Entity) {
  return { id: e.id, slug: e.slug, name: e.name, entity_type: e.entity_type, subtype: e.subtype };
}

// ── atlas_neighbors ────────────────────────────────────────────────────────
export function atlasNeighbors(ix: Indexes, id: string, window: number): ToolResult {
  const target = resolveNode(ix, id);
  if (!target) return { error: "Not found" };

  const parent = target.parentId ? (ix.docMap.get(target.parentId) ?? null) : null;
  const siblings = (ix.childrenIndex.get(target.parentId ?? "") ?? [])
    .filter((s) => s.id !== target.id)
    .slice(0, window * 2);
  const children = (ix.childrenIndex.get(target.id) ?? []).slice(0, window);

  return {
    target: docRow(target),
    parent: parent ? docRow(parent) : null,
    siblings: siblings.map(docRow),
    children: children.map(docRow),
  };
}

// ── atlas_traverse ─────────────────────────────────────────────────────────
export function atlasTraverse(
  ix: Indexes,
  id: string,
  edgeType: string | undefined,
  hops: number,
  direction: "out" | "in" | "both",
): ToolResult {
  const start = resolveNode(ix, id);
  if (!start) return { error: "Not found" };

  const visited = new Map<string, number>(); // id → depth
  visited.set(start.id, 0);
  const queue: Array<{ id: string; depth: number }> = [{ id: start.id, depth: 0 }];

  while (queue.length) {
    const { id: cur, depth } = queue.shift()!;
    if (depth >= hops) continue;
    for (const e of ix.edges) {
      if (edgeType && e.edge_type !== edgeType) continue;
      let neighbor: string | null = null;
      if ((direction === "out" || direction === "both") && e.from_id === cur) neighbor = e.to_id;
      else if ((direction === "in" || direction === "both") && e.to_id === cur) neighbor = e.from_id;
      if (neighbor && !visited.has(neighbor)) {
        visited.set(neighbor, depth + 1);
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  const results: Array<Record<string, unknown>> = [];
  for (const [nid, depth] of visited) {
    if (nid === start.id) continue;
    const doc = ix.docMap.get(nid);
    const ent = doc ? null : ix.entityById.get(nid);
    if (doc) results.push({ ...docRow(doc), depth });
    else if (ent) results.push({ ...entityRow(ent), depth });
  }
  results.sort((a, b) => (a.depth as number) - (b.depth as number) || String(a.doc_no ?? a.slug ?? "").localeCompare(String(b.doc_no ?? b.slug ?? "")));
  return { count: results.length, results };
}

// ── atlas_entity ───────────────────────────────────────────────────────────
export function atlasEntity(ix: Indexes, name: string): ToolResult {
  const entity = ix.entityBySlug.get(name.toLowerCase());
  const entityId = entity?.id ?? null;
  const rootId = entity?.defining_doc_id ?? null;

  // Nodes reachable from entity via outbound edges.
  const byEdge = entityId
    ? ix.edges
        .filter((e) => e.from_id === entityId && e.to_type === "doc")
        .map((e) => ix.docMap.get(e.to_id))
        .filter((n): n is AtlasNode => !!n)
        .map(docRow)
    : [];

  // Nodes in the entity's defining doc subtree.
  const byDocNo = rootId
    ? [...descendantIds(ix, rootId)]
        .map((id) => ix.docMap.get(id))
        .filter((n): n is AtlasNode => !!n)
        .map(docRow)
    : [];

  const responsibilities = entityId
    ? ix.edges
        .filter(
          (e) =>
            e.from_id === entityId &&
            ["responsible_party_for", "process_step_responsible_party_for"].includes(e.edge_type),
        )
        .map((e) => ix.docMap.get(e.to_id))
        .filter((n): n is AtlasNode => !!n)
        .map(docRow)
    : [];

  const activeData = entityId
    ? ix.edges
        .filter(
          (e) =>
            e.from_id === entityId &&
            ["Active Data Controller", "Active Data"].includes(ix.docMap.get(e.to_id)?.type ?? ""),
        )
        .map((e) => {
          const n = ix.docMap.get(e.to_id);
          return n ? { ...docRow(n), edge_type: e.edge_type } : null;
        })
        .filter(Boolean)
    : [];

  return { entity: name, entityId, nodes: [...byEdge, ...byDocNo], responsibilities, activeData };
}

// ── atlas_filter ───────────────────────────────────────────────────────────
export function atlasFilter(
  ix: Indexes,
  opts: {
    type?: string;
    entity?: string;
    ancestor_id?: string;
    doc_no_pattern?: string;
    depth_min?: number;
    depth_max?: number;
    limit: number;
    include_content: boolean;
  },
): ToolResult {
  const { type, entity, ancestor_id, doc_no_pattern, depth_min, depth_max, limit, include_content } = opts;
  if (!type && !entity && !ancestor_id && !doc_no_pattern && depth_min == null && depth_max == null) {
    return { error: "Provide at least one filter: type, entity, ancestor_id, doc_no_pattern, or depth_min/max" };
  }

  // Resolve subtree root.
  let rootId: string | null = null;
  if (ancestor_id) {
    const node = resolveNode(ix, ancestor_id);
    if (!node) return { error: `ancestor_id '${ancestor_id}' not found` };
    rootId = node.id;
  }
  if (entity && !rootId) {
    const ent = ix.entityBySlug.get(entity.toLowerCase());
    if (!ent?.defining_doc_id) return { error: `Entity '${entity}' not found` };
    rootId = ent.defining_doc_id;
  }

  const scope: Iterable<AtlasNode> = rootId
    ? ([...descendantIds(ix, rootId)].map((id) => ix.docMap.get(id)).filter(Boolean) as AtlasNode[])
    : ix.docMap.values();

  // SQL-style LIKE → JS regex (% → .*, _ → .)
  const patternRe = doc_no_pattern
    ? new RegExp("^" + doc_no_pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$")
    : null;

  const results: Array<Record<string, unknown>> = [];
  for (const n of scope) {
    if (type && n.type !== type) continue;
    if (patternRe && !patternRe.test(n.doc_no)) continue;
    if (depth_min != null && n.depth < depth_min) continue;
    if (depth_max != null && n.depth > depth_max) continue;
    const row: Record<string, unknown> = docRow(n);
    row.parent_id = n.parentId;
    if (include_content) row.content = n.content;
    results.push(row);
    if (results.length >= limit) break;
  }
  results.sort((a, b) => String(a.doc_no).localeCompare(String(b.doc_no)));
  return { count: results.length, results };
}

// ── atlas_entity_params ────────────────────────────────────────────────────
export function atlasEntityParams(
  ix: Indexes,
  opts: { id?: string; entity?: string; type_hint?: string; limit: number },
): ToolResult {
  const { id, entity, type_hint, limit } = opts;
  if (!id && !entity) return { error: "Provide id or entity" };

  let instanceIds: string[] = [];
  if (id) {
    const node = resolveNode(ix, id);
    if (!node) return { error: "Not found" };
    instanceIds = [node.id];
  } else if (entity) {
    const ent = ix.entityBySlug.get(entity.toLowerCase());
    if (!ent?.defining_doc_id) return { error: `Entity '${entity}' not found` };
    instanceIds = [...descendantIds(ix, ent.defining_doc_id)]
      .map((nid) => ix.docMap.get(nid))
      .filter((n): n is AtlasNode => !!n && (!type_hint || n.type === type_hint))
      .slice(0, limit)
      .map((n) => n.id);
  }
  if (instanceIds.length === 0) return { instances: [] };

  const instances = instanceIds.map((iid) => {
    const inst = ix.docMap.get(iid);
    if (!inst) return null;
    const params = (ix.childrenIndex.get(iid) ?? []).map((c) => ({
      id: c.id,
      doc_no: c.doc_no,
      title: c.title,
      type: c.type,
      content: c.content,
    }));
    return { id: inst.id, doc_no: inst.doc_no, title: inst.title, type: inst.type, params };
  }).filter(Boolean);

  return { instances };
}
