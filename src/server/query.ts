// atlas_query — one-call multi-dimensional query. Combines hybrid search,
// entity graph traversal (graphology), doc-type filter, history window
// (atlas_history), status filter, and ancestor scope; all active dimensions are
// intersected. Ports the CF worker's logic with D1 recursive CTEs replaced by
// graphology traversals + the in-memory doc map, and Vectorize by pgvector.
import { type Indexes, type AtlasNode, ancestorChain, descendantIds, resolveNode } from "./indexes.ts";
import { runLexical, runSemantic, rrfMerge, buildSnippet, extractPhrases, matchesPhrases } from "./search.ts";
import { sql } from "./db.ts";
import type { ToolResult } from "./tools.ts";

export interface QueryArgs {
  q?: string;
  entity?: string;
  edge_types?: string[];
  target_type?: string;
  via_entity_type?: string;
  since?: string;
  until?: string;
  change_type?: string;
  recent_commits?: number;
  status?: string;
  ancestor_id?: string;
  include_params?: boolean;
  direction?: "out" | "in" | "both";
  k: number;
  enrich: boolean;
}

// "30d" → ISO date 30 days ago; ISO strings pass through.
function resolveSince(s: string): string {
  const rel = s.match(/^(\d+)d$/);
  if (rel) return new Date(Date.now() - parseInt(rel[1]) * 86_400_000).toISOString().slice(0, 10);
  return s;
}

async function historySet(
  since?: string,
  until?: string,
  changeType?: string,
  recentCommits?: number,
): Promise<Set<string> | null> {
  if (!since && !until && !changeType && !recentCommits) return null;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (recentCommits) {
    params.push(recentCommits);
    conds.push(`commit_seq >= (SELECT MAX(commit_seq) FROM atlas_history) - $${params.length}`);
  }
  if (since) { params.push(resolveSince(since)); conds.push(`committed_at >= $${params.length}`); }
  if (until) { params.push(resolveSince(until)); conds.push(`committed_at <= $${params.length}`); }
  if (changeType) { params.push(changeType); conds.push(`change_type = $${params.length}`); }
  const rows = (await sql.unsafe(
    `SELECT DISTINCT doc_id FROM atlas_history WHERE ${conds.join(" AND ")}`,
    params,
  )) as { doc_id: string }[];
  return new Set(rows.map((r) => r.doc_id));
}

function statusSet(ix: Indexes, status: string): Set<string> {
  // Word-boundary match, not substring: 'Active' must not match 'Inactive'
  // (which contains "active"). \b around the (regex-escaped) status token gives
  // CF's FTS5-token semantics without the inversion bug.
  const re = new RegExp(`\\b${status.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const out = new Set<string>();
  for (const d of ix.docMap.values()) {
    if (re.test(d.content) || re.test(d.title)) out.add(d.id);
  }
  return out;
}

function intersect(ids: string[], ...sets: Array<Set<string> | null>): string[] {
  let r = ids;
  for (const s of sets) if (s) r = r.filter((id) => s.has(id));
  return r;
}

type Dir = "out" | "in" | "both";

// Docs connected to an entity. Many atlas relationships (active_data_for,
// responsible_party_for, …) are doc→entity, so default direction is "both" —
// out-only misses an entity's responsibilities entirely.
//
// Entity ids often EQUAL their defining doc's id (graph.json reuses the UUID),
// so the shared graphology node carries BOTH the doc's structural edges
// (parent_of, cites, …) and the entity's relationship edges. We must therefore
// require the ENTITY-SIDE endpoint to be declared `entity` — otherwise the
// defining doc's doc→doc edges leak in as if they were the entity's. consider()
// takes (entitySideType, docSideType) = (from,to) for out-edges, (to,from) for in.
function entityDocs(
  ix: Indexes,
  entityId: string,
  edgeTypes: string[] | undefined,
  targetType: string | undefined,
  dir: Dir,
) {
  const out: { edge_type: string; doc: AtlasNode; dir: "out" | "in" }[] = [];
  if (!ix.graph.hasNode(entityId)) return out;
  const consider = (
    etype: string,
    entitySideType: string,
    docSideType: string,
    otherId: string,
    edir: "out" | "in",
  ) => {
    if (entitySideType !== "entity" || docSideType !== "doc") return;
    if (edgeTypes?.length && !edgeTypes.includes(etype)) return;
    const doc = ix.docMap.get(otherId);
    if (!doc || (targetType && doc.type !== targetType)) return;
    out.push({ edge_type: etype, doc, dir: edir });
  };
  if (dir !== "in")
    ix.graph.forEachOutEdge(entityId, (_k, a, _s, tgt) => consider(a.edge_type, a.from_type, a.to_type, tgt, "out"));
  if (dir !== "out")
    ix.graph.forEachInEdge(entityId, (_k, a, src) => consider(a.edge_type, a.to_type, a.from_type, src, "in"));
  return out;
}

// Entities of via_type connected to an entity (entity-chain). Same id-collision
// guard: both endpoints must be declared `entity`, so the defining doc's
// doc→doc / doc→entity edges don't masquerade as the entity's chain links.
function chainEntityIds(ix: Indexes, entityId: string, viaType: string, edgeTypes: string[] | undefined, dir: Dir): string[] {
  const ids = new Set<string>();
  if (!ix.graph.hasNode(entityId)) return [];
  const consider = (etype: string, entitySideType: string, otherSideType: string, otherId: string) => {
    if (entitySideType !== "entity" || otherSideType !== "entity") return;
    if (edgeTypes?.length && !edgeTypes.includes(etype)) return;
    const e = ix.entityById.get(otherId);
    if (e && e.entity_type === viaType) ids.add(otherId);
  };
  if (dir !== "in")
    ix.graph.forEachOutEdge(entityId, (_k, a, _s, tgt) => consider(a.edge_type, a.from_type, a.to_type, tgt));
  if (dir !== "out")
    ix.graph.forEachInEdge(entityId, (_k, a, src) => consider(a.edge_type, a.to_type, a.from_type, src));
  return [...ids];
}

function enrichNode(ix: Indexes, n: AtlasNode, enrich: boolean, includeParams: boolean) {
  const base: Record<string, unknown> = {
    id: n.id, doc_no: n.doc_no, title: n.title, type: n.type, depth: n.depth, parent_id: n.parentId,
  };
  if (enrich) { base.content = n.content; base.ancestors = ancestorChain(ix, n.id); }
  if (includeParams) {
    base.params = (ix.childrenIndex.get(n.id) ?? []).map((c) => ({
      id: c.id, doc_no: c.doc_no, name: c.title, type: c.type, value: c.content,
    }));
  }
  return base;
}

export async function atlasQuery(ix: Indexes, a: QueryArgs): Promise<ToolResult> {
  if (!a.q && !a.entity && !a.target_type) {
    return { error: "at least one of q, entity, or target_type is required" };
  }

  let entityId: string | null = null;
  if (a.entity) {
    const e = ix.entityBySlug.get(a.entity);
    if (!e) return { error: `Entity '${a.entity}' not found` };
    entityId = e.id;
  }

  const [hist, stat] = await Promise.all([
    historySet(a.since, a.until, a.change_type, a.recent_commits),
    Promise.resolve(a.status ? statusSet(ix, a.status) : null),
  ]);
  // A miss resolves to null (= no constraint), NOT an empty set — an empty set
  // would intersect every result away, so a typo'd ancestor_id would silently
  // zero the whole response instead of being ignored (matches CF behavior).
  const anc = a.ancestor_id
    ? (() => { const node = resolveNode(ix, a.ancestor_id!); return node ? descendantIds(ix, node.id) : null; })()
    : null;
  const constrain = (ids: string[]) => intersect(ids, hist, anc, stat);
  const enrich = (nodes: AtlasNode[]) => nodes.map((n) => enrichNode(ix, n, a.enrich, !!a.include_params));
  const dir: Dir = a.direction ?? "both";

  // ── entity_chain ────────────────────────────────────────────────────────────
  if (entityId && a.via_entity_type) {
    const chain = chainEntityIds(ix, entityId, a.via_entity_type, a.edge_types, dir);
    const docs = new Map<string, AtlasNode>();
    for (const cid of chain) for (const { doc } of entityDocs(ix, cid, undefined, a.target_type, dir)) docs.set(doc.id, doc);
    const kept = constrain([...docs.keys()]).slice(0, a.k).map((id) => docs.get(id)!);
    return { entity: a.entity, via_entity_type: a.via_entity_type, mode: "entity_chain", count: kept.length, results: enrich(kept) };
  }

  // ── entity_broad ──────────────────────────────────────────────────────────────
  if (entityId && !a.edge_types?.length && !a.q) {
    const grouped: Record<string, unknown[]> = {};
    for (const { edge_type, doc } of entityDocs(ix, entityId, undefined, a.target_type, dir)) {
      (grouped[edge_type] ??= []).push(doc);
    }
    for (const rel of Object.keys(grouped)) {
      const docs = grouped[rel] as AtlasNode[];
      const kept = constrain(docs.map((d) => d.id)).map((id) => docs.find((d) => d.id === id)!);
      if (kept.length === 0) delete grouped[rel];
      else grouped[rel] = enrich(kept);
    }
    return { entity: a.entity, mode: "entity_broad", by_relationship: grouped };
  }

  // ── type_list ────────────────────────────────────────────────────────────────
  if (!a.entity && !a.q && a.target_type) {
    const rows = [...ix.docMap.values()].filter((d) => d.type === a.target_type);
    const kept = constrain(rows.map((r) => r.id)).slice(0, a.k).map((id) => ix.docMap.get(id)!);
    return { mode: "type_list", type: a.target_type, count: kept.length, results: enrich(kept) };
  }

  // ── entity doc set (for narrow / intersection) ───────────────────────────────
  let entityDocIds: Set<string> | null = null;
  if (entityId) {
    const docs = entityDocs(ix, entityId, a.edge_types, a.target_type, dir);
    entityDocIds = new Set(constrain([...new Set(docs.map((d) => d.doc.id))]));
  }

  // ── search ───────────────────────────────────────────────────────────────────
  let searchHits: { id: string; rrf_score: number; score: number; snippet?: string }[] = [];
  if (a.q) {
    const { phrases, casePhrases } = extractPhrases(a.q);
    const fetchK = Math.min(a.k * 4, 200);
    const [lex, sem] = await Promise.all([
      Promise.resolve(runLexical(ix, a.q, a.target_type, fetchK)),
      runSemantic(ix, a.q, a.target_type, fetchK).catch(() => []),
    ]);
    let merged = rrfMerge(lex, sem);
    // Quoted phrases require an exact match — same shared post-filter
    // atlas_search applies, so the two tools agree on phrase queries.
    if (phrases.length || casePhrases.length) {
      merged = merged.filter((m) => {
        const n = ix.docMap.get(m.id);
        return n ? matchesPhrases(n.title, n.content, phrases, casePhrases) : false;
      });
    }
    searchHits = merged.map((m) => ({ id: m.id, rrf_score: m.rrf_score, score: m.score }));
  }

  // ── intersect / narrow ────────────────────────────────────────────────────────
  if (!a.q && entityDocIds) {
    const ids = [...entityDocIds].slice(0, a.k);
    const nodes = ids.map((id) => ix.docMap.get(id)!).filter(Boolean);
    return { entity: a.entity, mode: "entity_narrow", count: nodes.length, results: enrich(nodes) };
  }

  let hits = a.q && entityDocIds ? searchHits.filter((h) => entityDocIds!.has(h.id)) : searchHits;
  const constrained = new Set(constrain(hits.map((h) => h.id)));
  hits = hits.filter((h) => constrained.has(h.id)).slice(0, a.k);
  const mode = a.q && entityDocIds ? "hybrid_graph" : "search";
  const results = hits.map((h) => {
    const n = ix.docMap.get(h.id)!;
    return { ...enrichNode(ix, n, a.enrich, !!a.include_params), snippet: buildSnippet(n.content, a.q ?? ""), score: h.rrf_score || h.score };
  });
  return { mode, count: results.length, results };
}
