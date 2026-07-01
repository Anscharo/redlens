// Graph-traversal and structural-filter tools that run entirely in-memory.
// No DB access — all data comes from the Indexes (docs, entities, edges).
import { type Indexes, resolveNode, descendantIds, type AtlasNode, type Entity } from "./indexes.ts";
import { type ToolResult } from "./tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "./output-budget.ts";
import { matchEntities, resolveEntity } from "./entity-resolve.ts";

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
  maxHops: number,
  direction: "out" | "in" | "both",
): ToolResult {
  const start = resolveNode(ix, id);
  if (!start) return { error: "Not found" };

  // id → how it was first reached: hop distance from the start node, the edge
  // type + direction of the discovering edge, and `from` (the predecessor node)
  // so a multi-hop route can be reconstructed. `hops` is BFS distance (NOT the
  // node's atlas depth — docRow still carries that as `depth`).
  type Reach = { hops: number; edge_type: string | null; direction: "out" | "in" | null; from: string | null };
  const visited = new Map<string, Reach>();
  visited.set(start.id, { hops: 0, edge_type: null, direction: null, from: null });
  const queue: Array<{ id: string; hops: number }> = [{ id: start.id, hops: 0 }];

  while (queue.length) {
    const { id: cur, hops } = queue.shift()!;
    if (hops >= maxHops) continue;
    for (const e of ix.edges) {
      if (edgeType && e.edge_type !== edgeType) continue;
      let neighbor: string | null = null;
      let dir: "out" | "in" | null = null;
      if ((direction === "out" || direction === "both") && e.from_id === cur) {
        neighbor = e.to_id;
        dir = "out";
      } else if ((direction === "in" || direction === "both") && e.to_id === cur) {
        neighbor = e.from_id;
        dir = "in";
      }
      if (neighbor && !visited.has(neighbor)) {
        visited.set(neighbor, { hops: hops + 1, edge_type: e.edge_type, direction: dir, from: cur });
        queue.push({ id: neighbor, hops: hops + 1 });
      }
    }
  }

  // Reconstruct the route start→node as steps (each = the edge stepped through +
  // the node it led to), for multi-hop results where the discovering edge alone
  // doesn't reveal how the node was reached.
  const stepLabel = (nid: string) => {
    const d = ix.docMap.get(nid);
    return d ? { id: nid, doc_no: d.doc_no } : { id: nid, slug: ix.entityById.get(nid)?.slug ?? null };
  };
  const pathTo = (nid: string) => {
    const steps: Array<Record<string, unknown>> = [];
    for (let cur: string | null = nid; cur && cur !== start.id; cur = visited.get(cur)!.from) {
      const r = visited.get(cur)!;
      steps.push({ ...stepLabel(cur), edge_type: r.edge_type, direction: r.direction });
    }
    return steps.reverse();
  };

  const results: Array<Record<string, unknown>> = [];
  for (const [nid, r] of visited) {
    if (nid === start.id) continue;
    const doc = ix.docMap.get(nid);
    const ent = doc ? null : ix.entityById.get(nid);
    const base = doc ? docRow(doc) : ent ? entityRow(ent) : null;
    if (base) {
      const row: Record<string, unknown> = { ...base, hops: r.hops, edge_type: r.edge_type, direction: r.direction };
      if (r.hops >= 2) row.path = pathTo(nid); // single-hop route is just the node itself
      results.push(row);
    }
  }
  results.sort(
    (a, b) =>
      (a.hops as number) - (b.hops as number) ||
      String(a.doc_no ?? a.slug ?? "").localeCompare(String(b.doc_no ?? b.slug ?? "")),
  );
  return { count: results.length, results };
}

// ── atlas_entity ───────────────────────────────────────────────────────────
export function atlasEntity(
  ix: Indexes,
  name: string,
  opts: { type?: string; limit: number; offset: number; include_content: boolean },
): ToolResult {
  const { type, limit, offset, include_content } = opts;
  // Accept natural-language names ("Spark Protocol") — resolution happens here,
  // exact slugs still win. `resolved`/`alternatives` make the mapping visible.
  const matches = matchEntities(ix, name, 6);
  if (matches.length === 0) return { error: `No entity matches '${name}'. Use atlas_entities to search by name/type.` };
  const entity = matches[0].entity;
  const alternatives = matches.slice(1).map((m) => entityRow(m.entity));
  const entityId = entity.id;
  const rootId = entity.defining_doc_id;

  // The entity's node set = (a) docs linked from the entity via outbound edges
  // ∪ (b) the entity's defining-doc subtree. Deduped by id, edge-linked first.
  // For a Prime Agent this subtree is huge (2000+ nodes), so it MUST be paged.
  const seen = new Set<string>();
  const collect: AtlasNode[] = [];
  const push = (n: AtlasNode | undefined) => {
    if (n && !seen.has(n.id)) {
      seen.add(n.id);
      collect.push(n);
    }
  };
  for (const e of ix.edges) if (e.from_id === entityId && e.to_type === "doc") push(ix.docMap.get(e.to_id));
  if (rootId) for (const did of descendantIds(ix, rootId)) push(ix.docMap.get(did));

  // Type histogram over the FULL set so the caller can pick a `type` filter to
  // narrow the next call, even when this page only shows a slice.
  const node_types: Record<string, number> = {};
  for (const n of collect) node_types[n.type] = (node_types[n.type] ?? 0) + 1;

  const filtered = type ? collect.filter((n) => n.type === type) : collect;
  const page = filtered.slice(offset, offset + limit);
  const rows = page.map((n) => (include_content ? { ...docRow(n), content: n.content } : docRow(n)));
  const { kept: nodes, truncated } = fitToBudget(rows);

  const responsibilities = ix.edges
    .filter((e) => e.from_id === entityId && e.edge_type === "responsible_party_for")
    .map((e) => ix.docMap.get(e.to_id))
    .filter((n): n is AtlasNode => !!n)
    .map(docRow);

  const activeData = ix.edges
    .filter(
      (e) =>
        e.from_id === entityId &&
        ["Active Data Controller", "Active Data"].includes(ix.docMap.get(e.to_id)?.type ?? ""),
    )
    .map((e) => {
      const n = ix.docMap.get(e.to_id);
      return n ? { ...docRow(n), edge_type: e.edge_type } : null;
    })
    .filter(Boolean);

  return {
    entity: name,
    resolved: { slug: entity.slug, name: entity.name, entity_type: entity.entity_type, subtype: entity.subtype },
    alternatives,
    entityId,
    node_count: filtered.length,
    node_types,
    offset,
    returned: nodes.length,
    has_more: offset + nodes.length < filtered.length,
    ...(truncated ? { truncated: true, hint: TRUNCATION_HINT } : {}),
    nodes,
    responsibilities,
    activeData,
  };
}

// ── atlas_entities (discovery / resolution) ──────────────────────────────────
// Find entities by free-text name and/or structural filters. This is the tool
// an assistant reaches for FIRST to turn "Spark" into a slug — atlas_describe no
// longer dumps the full slug list.
export function atlasEntities(
  ix: Indexes,
  opts: { q?: string; entity_type?: string; subtype?: string; limit: number; offset: number },
): ToolResult {
  const { q, entity_type, subtype, limit, offset } = opts;
  const sub = subtype?.toLowerCase();
  const scored: { entity: Entity; score?: number }[] = q
    ? matchEntities(ix, q, 1000)
    : ix.entities.map((entity) => ({ entity }));
  let filtered = scored.filter(
    ({ entity }) =>
      (!entity_type || entity.entity_type === entity_type) &&
      (!sub || (entity.subtype ?? "").toLowerCase().includes(sub)),
  );
  if (!q) filtered = filtered.sort((a, b) => a.entity.slug.localeCompare(b.entity.slug));

  const total = filtered.length;
  const results = filtered.slice(offset, offset + limit).map(({ entity, score }) => ({
    ...entityRow(entity),
    defining_doc_id: entity.defining_doc_id,
    ...(score != null ? { score } : {}),
  }));
  return { total, offset, count: results.length, has_more: offset + results.length < total, results };
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
  const { kept, truncated } = fitToBudget(results);
  return { count: kept.length, ...(truncated ? { total: results.length, truncated: true, hint: TRUNCATION_HINT } : {}), results: kept };
}

// ── atlas_entity_params ────────────────────────────────────────────────────
export function atlasEntityParams(
  ix: Indexes,
  opts: { id?: string; entity?: string; type_hint?: string; limit: number },
): ToolResult {
  const { id, entity, type_hint, limit } = opts;
  if (!id && !entity) return { error: "Provide id or entity" };

  let instanceIds: string[] = [];
  // When resolving by entity, expose the instance subtypes present so the
  // caller can refine `type_hint` (which matches the instance SUBTYPE, e.g.
  // "distribution-reward", NOT the atlas doc type).
  let available_subtypes: string[] | undefined;
  if (id) {
    const node = resolveNode(ix, id);
    if (!node) return { error: "Not found" };
    instanceIds = [node.id];
  } else if (entity) {
    const ent = resolveEntity(ix, entity);
    if (!ent?.defining_doc_id) return { error: `No entity matches '${entity}'. Use atlas_entities to search by name/type.` };
    // Instance docs under this entity = defining docs of `instance` entities
    // whose defining doc falls within the entity's subtree. This is what the
    // tool means by "instance docs" — not every doc in the subtree.
    const subtree = descendantIds(ix, ent.defining_doc_id);
    const instEntities = ix.entities.filter(
      (e) => e.entity_type === "instance" && e.defining_doc_id && subtree.has(e.defining_doc_id),
    );
    available_subtypes = [...new Set(instEntities.map((e) => e.subtype).filter((s): s is string => !!s))].sort();
    const hint = type_hint?.toLowerCase();
    const matched = hint
      ? instEntities.filter((e) => (e.subtype ?? "").toLowerCase().includes(hint))
      : instEntities;
    // Dedupe defining docs (an instance may back multiple entity rows), cap at limit.
    instanceIds = [...new Set(matched.map((e) => e.defining_doc_id as string))].slice(0, limit);
  }
  if (instanceIds.length === 0) return entity ? { instances: [], available_subtypes } : { instances: [] };

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

  const { kept, truncated } = fitToBudget(instances);
  const trunc = truncated ? { truncated: true, hint: TRUNCATION_HINT } : {};
  return entity ? { instances: kept, available_subtypes, ...trunc } : { instances: kept, ...trunc };
}
