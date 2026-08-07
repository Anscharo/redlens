// Graph-traversal and structural-filter tools that run entirely in-memory.
// No DB access — all data comes from the Indexes (docs, entities, edges).
import { type Indexes, resolveNode, descendantIds, type AtlasNode, type Entity } from "../../retrieval/indexes.ts";
import { type ToolResult, livenessOf, withLivenessHint } from "./tools.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import { matchEntities, resolveEntity } from "../../retrieval/entity-resolve.ts";
import { entityAddresses } from "./tools-entity-addresses.ts";

// Slim node row for tool responses.
function docRow(n: AtlasNode) {
  return { id: n.id, doc_no: n.doc_no, title: n.title, type: n.type, depth: n.depth };
}
function entityRow(e: Entity) {
  return { id: e.id, slug: e.slug, name: e.name, entity_type: e.entity_type, subtype: e.subtype };
}
// Graph address node → row. The key is `<address>:<chain>`; base58 Solana
// addresses carry no colon of their own, so the LAST one is the separator.
function addressRow(id: string) {
  const i = id.lastIndexOf(":");
  return { id, node_type: "address", address: i === -1 ? id : id.slice(0, i), chain: i === -1 ? null : id.slice(i + 1) };
}
function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return { raw };
  }
}
function sourceDocNos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    // Fall through to the legacy/string fallback.
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
function endpointRow(ix: Indexes, id: string, nodeType: string) {
  if (nodeType === "doc") {
    const d = ix.docMap.get(id);
    return d
      ? { id, node_type: "doc", type: d.type, name: d.title, doc_no: d.doc_no }
      : { id, node_type: "doc", type: "doc", name: id };
  }
  if (nodeType === "entity") {
    const e = ix.entityById.get(id);
    return e
      ? { id, node_type: "entity", slug: e.slug, type: e.entity_type, subtype: e.subtype, name: e.name }
      : { id, node_type: "entity", type: "entity", name: id };
  }
  return { id, node_type: nodeType, type: nodeType, name: id };
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

  const parentRow = parent ? { ...docRow(parent), ...livenessOf(ix, parent.id) } : null;
  const siblingRows = siblings.map((s) => ({ ...docRow(s), ...livenessOf(ix, s.id) }));
  const childRows = children.map((c) => ({ ...docRow(c), ...livenessOf(ix, c.id) }));

  const envelope = { target: docRow(target), parent: parentRow, siblings: siblingRows, children: childRows };
  return withLivenessHint(envelope, [...(parentRow ? [parentRow] : []), ...siblingRows, ...childRows]);
}

// ── atlas_traverse ─────────────────────────────────────────────────────────
export function atlasTraverse(
  ix: Indexes,
  id: string,
  edgeType: string | undefined,
  maxHops: number,
  direction: "out" | "in" | "both",
): ToolResult {
  // Docs resolve by uuid/doc_no; entities by slug or natural-language name.
  // Accepting a slug is load-bearing, not a convenience: the entity tools hand
  // the caller a slug and nothing else, so slug-rejection made the graph's only
  // multi-hop tool unreachable for every entity question.
  const startId = resolveNode(ix, id)?.id ?? ix.entityBySlug.get(id.toLowerCase())?.id ?? resolveEntity(ix, id)?.id;
  if (!startId) return { error: "Not found" };

  // id → how it was first reached: hop distance from the start node, the edge
  // type + direction of the discovering edge, the node kind (so address nodes
  // — which live in neither docMap nor entityById — can still be rendered), and
  // `from` (the predecessor node) so a multi-hop route can be reconstructed.
  // `hops` is BFS distance (NOT the node's atlas depth — docRow still carries
  // that as `depth`).
  type Reach = { hops: number; edge_type: string | null; direction: "out" | "in" | null; from: string | null; node_type: string | null };
  const visited = new Map<string, Reach>();
  visited.set(startId, { hops: 0, edge_type: null, direction: null, from: null, node_type: null });
  const queue: Array<{ id: string; hops: number }> = [{ id: startId, hops: 0 }];

  while (queue.length) {
    const { id: cur, hops } = queue.shift()!;
    if (hops >= maxHops) continue;
    for (const e of ix.edges) {
      if (edgeType && e.edge_type !== edgeType) continue;
      let neighbor: string | null = null;
      let dir: "out" | "in" | null = null;
      let kind: string | null = null;
      if ((direction === "out" || direction === "both") && e.from_id === cur) {
        neighbor = e.to_id;
        dir = "out";
        kind = e.to_type;
      } else if ((direction === "in" || direction === "both") && e.to_id === cur) {
        neighbor = e.from_id;
        dir = "in";
        kind = e.from_type;
      }
      if (neighbor && !visited.has(neighbor)) {
        visited.set(neighbor, { hops: hops + 1, edge_type: e.edge_type, direction: dir, from: cur, node_type: kind });
        queue.push({ id: neighbor, hops: hops + 1 });
      }
    }
  }

  // Reconstruct the route start→node as steps (each = the edge stepped through +
  // the node it led to), for multi-hop results where the discovering edge alone
  // doesn't reveal how the node was reached.
  const stepLabel = (nid: string) => {
    const d = ix.docMap.get(nid);
    if (d) return { id: nid, doc_no: d.doc_no };
    const ent = ix.entityById.get(nid);
    return ent ? { id: nid, slug: ent.slug } : { id: nid };
  };
  const pathTo = (nid: string) => {
    const steps: Array<Record<string, unknown>> = [];
    for (let cur: string | null = nid; cur && cur !== startId; cur = visited.get(cur)!.from) {
      const r = visited.get(cur)!;
      steps.push({ ...stepLabel(cur), edge_type: r.edge_type, direction: r.direction });
    }
    return steps.reverse();
  };

  const results: Array<Record<string, unknown>> = [];
  for (const [nid, r] of visited) {
    if (nid === startId) continue;
    const doc = ix.docMap.get(nid);
    const ent = doc ? null : ix.entityById.get(nid);
    // Address nodes are keyed `<address>:<chain>` and exist in neither map;
    // they used to be dropped here, which made every on-chain question invisible
    // to the one tool built for multi-hop traversal.
    const base = doc ? docRow(doc) : ent ? entityRow(ent) : r.node_type === "address" ? addressRow(nid) : null;
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
  const rows = page.map((n) => ({
    ...(include_content ? { ...docRow(n), content: n.content } : docRow(n)),
    ...livenessOf(ix, n.id),
  }));
  const { kept: nodes, truncated } = fitToBudget(rows);

  const responsibilities = ix.edges
    .filter(
      (e) =>
        e.from_id === entityId &&
        ["responsible_party_for", "process_step_responsible_party_for", "duty_for"].includes(e.edge_type),
    )
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

  const envelope = {
    entity: name,
    resolved: { slug: entity.slug, name: entity.name, entity_type: entity.entity_type, subtype: entity.subtype },
    alternatives,
    entityId,
    // Before `nodes` on purpose: the address block answers "what addresses does
    // X have" outright, and must never be the section a budget trim eats.
    addresses: entityAddresses(ix, entityId),
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
  return withLivenessHint(envelope, nodes);
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

// ── atlas_edges ────────────────────────────────────────────────────────────
export function atlasEdges(
  ix: Indexes,
  opts: {
    edge_type?: string;
    from_type?: string;
    to_type?: string;
    from_slug?: string;
    to_slug?: string;
    include_docs: boolean;
    limit: number;
    offset: number;
  },
): ToolResult {
  const { edge_type, from_type, to_type, from_slug, to_slug, include_docs, limit, offset } = opts;
  const fromEntity = from_slug ? ix.entityBySlug.get(from_slug.toLowerCase()) : null;
  const toEntity = to_slug ? ix.entityBySlug.get(to_slug.toLowerCase()) : null;
  if (from_slug && !fromEntity) return { error: `from_slug '${from_slug}' not found` };
  if (to_slug && !toEntity) return { error: `to_slug '${to_slug}' not found` };

  const filtered = ix.edges.filter((e) =>
    (!edge_type || e.edge_type === edge_type) &&
    (!from_type || e.from_type === from_type) &&
    (!to_type || e.to_type === to_type) &&
    (!fromEntity || e.from_id === fromEntity.id) &&
    (!toEntity || e.to_id === toEntity.id),
  );
  const total = filtered.length;
  const page = filtered.slice(offset, offset + limit);
  const rows = page.map((e) => {
    const docNos = sourceDocNos(e.source_doc_nos);
    const row: Record<string, unknown> = {
      id: e.id,
      edge_type: e.edge_type,
      from: endpointRow(ix, e.from_id, e.from_type),
      to: endpointRow(ix, e.to_id, e.to_type),
      meta: parseJsonObject(e.meta) ?? {},
      source_doc_nos: docNos,
    };
    if (include_docs) {
      row.provenance = docNos.map((doc_no) => {
        const doc = ix.byDocNo.get(doc_no);
        return doc ? { node_id: doc.id, doc_no: doc.doc_no, title: doc.title, type: doc.type } : { doc_no };
      });
    }
    return row;
  });
  const { kept, truncated } = fitToBudget(rows);
  const nextOffset = offset + kept.length < total ? offset + kept.length : null;
  return {
    total,
    limit,
    offset,
    count: kept.length,
    has_more: nextOffset != null,
    ...(nextOffset != null ? { next_offset: nextOffset } : {}),
    ...(truncated ? { truncated: true, hint: TRUNCATION_HINT } : {}),
    edges: kept,
  };
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
    const row: Record<string, unknown> = { ...docRow(n), ...livenessOf(ix, n.id) };
    row.parent_id = n.parentId;
    if (include_content) row.content = n.content;
    results.push(row);
    if (results.length >= limit) break;
  }
  results.sort((a, b) => String(a.doc_no).localeCompare(String(b.doc_no)));
  const { kept, truncated } = fitToBudget(results);
  const envelope = { count: kept.length, ...(truncated ? { total: results.length, truncated: true, hint: TRUNCATION_HINT } : {}), results: kept };
  return withLivenessHint(envelope, kept);
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
