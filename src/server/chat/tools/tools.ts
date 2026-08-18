// Pure, transport-agnostic atlas tool functions. The MCP layer (mcp.ts) and a
// future /api/chat loop both call these directly. Each returns a plain object;
// the caller wraps it for its transport.
//
// This file currently holds the DB-free tools (describe, get). Search /
// address / query land alongside in Task #6 once the pg + embedding layers
// exist; they take the same Indexes plus a SQL handle.
import { type Indexes, ancestorChain, resolveNode, type AtlasNode } from "../../retrieval/indexes.ts";
import { runLexical, runSemantic, rrfMerge, attributeSemanticHits, buildLeafScorer, filterByType, buildAgentSnippet, extractPhrases, matchesPhrases, type MergedHit, type SemanticResult } from "../../retrieval/search.ts";
import { fitToBudget, TRUNCATION_HINT } from "../output-budget.ts";
import { statsSection } from "./tools-stats.ts";
import { censusesSection } from "./tools-censuses.ts";
import { sql } from "../../db.ts";
import { normalizeAddress } from "../../../../scripts/lib/address-chains.mjs";
import type { Liveness } from "../../../lib/liveness.ts";

export interface ToolResult {
  [k: string]: unknown;
}

// ── liveness tagging (docs/research/synlang-wiki.md §3.2) ──────────────────
// Every call site that emits doc rows decorates them via this one lookup, so
// the scaffold/placeholder tag is never re-derived. Docs absent from
// `ix.liveness` are settled, so the field is OMITTED (not `liveness: null`) —
// most rows carry no field at all.
export function livenessOf(ix: Indexes, id: string): { liveness?: Liveness } {
  const tag = ix.liveness.get(id);
  return tag ? { liveness: tag } : {};
}

// Neutral framing is load-bearing: on the real corpus 932/962 scaffold tags
// are lifecycle status-bucket directories where empty is EXPECTED, not a
// finding. Envelope-level (once per response), never repeated per row.
export const LIVENESS_HINT =
  "liveness:scaffold = an empty container (normal for lifecycle directories) — its existence does NOT establish that the thing it would hold exists. liveness:placeholder = content not yet specified.";

export function withLivenessHint<T extends ToolResult>(envelope: T, rows: unknown[]): T {
  const hasTag = rows.some((r) => !!r && typeof r === "object" && (r as { liveness?: unknown }).liveness);
  return hasTag ? { ...envelope, liveness_hint: LIVENESS_HINT } : envelope;
}

// ── atlas_describe ──────────────────────────────────────────────────────────
// Default sections are the cheap, always-useful vocab; the heavier
// entity_type_graph + type_specifications are opt-in via `sections`.
const DEFAULT_SECTIONS = new Set(["doc_types", "edge_types", "entity_types"]);
const ALL_SECTIONS = ["doc_types", "edge_types", "entity_types", "entity_type_graph", "type_specifications", "stats", "censuses"];

export function atlasDescribe(ix: Indexes, sections?: string[]): ToolResult {
  // Provided sections → exactly those (or everything for 'all'); omitted → defaults.
  const want = (s: string) =>
    sections && sections.length ? sections.includes(s) || sections.includes("all") : DEFAULT_SECTIONS.has(s);

  const docTypeCounts = new Map<string, number>();
  const typeSpecs: { id: string; doc_no: string; title: string }[] = [];
  for (const d of ix.docMap.values()) {
    docTypeCounts.set(d.type, (docTypeCounts.get(d.type) ?? 0) + 1);
    if (d.type === "Type Specification") typeSpecs.push({ id: d.id, doc_no: d.doc_no, title: d.title });
  }

  const edgeTypeCounts = new Map<string, number>();
  for (const e of ix.edges) edgeTypeCounts.set(e.edge_type, (edgeTypeCounts.get(e.edge_type) ?? 0) + 1);

  const entityTypeCounts = new Map<string, number>();
  let entityCount = 0;
  for (const e of ix.entities) {
    if (!e.is_active) continue;
    const key = `${e.entity_type} ${e.subtype ?? ""}`;
    entityTypeCounts.set(key, (entityTypeCounts.get(key) ?? 0) + 1);
    entityCount++;
  }

  // entity_type_graph: how entity types connect via edges (traversal chains).
  const etg = new Map<string, number>();
  for (const e of ix.edges) {
    if (e.from_type !== "entity" || e.to_type !== "entity") continue;
    const from = ix.entityById.get(e.from_id);
    const to = ix.entityById.get(e.to_id);
    if (!from?.is_active || !to?.is_active) continue;
    const key = `${from.entity_type} ${e.edge_type} ${to.entity_type}`;
    etg.set(key, (etg.get(key) ?? 0) + 1);
  }

  const sortDesc = <T>(m: Map<string, number>, shape: (k: string, count: number) => T): T[] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => shape(k, c));

  const out: ToolResult = {
    doc_count: ix.docMap.size,
    entity_count: entityCount,
    entities_hint: "Use atlas_entities to search/list entities by name, type, or subtype.",
    available_sections: ALL_SECTIONS,
    doc_types: sortDesc(docTypeCounts, (type, count) => ({ type, count })),
    edge_types: sortDesc(edgeTypeCounts, (edge_type, count) => ({ edge_type, count })),
    entity_types: sortDesc(entityTypeCounts, (k, count) => {
      const [entity_type, subtype] = k.split(" ");
      return { entity_type, subtype: subtype || null, count };
    }),
  };
  if (want("entity_type_graph"))
    out.entity_type_graph = sortDesc(etg, (k, count) => {
      const [from_type, edge_type, to_type] = k.split(" ");
      return { from_type, edge_type, to_type, count };
    });
  if (want("type_specifications"))
    out.type_specifications = typeSpecs.sort((a, b) => a.doc_no.localeCompare(b.doc_no, "en", { numeric: true }));
  if (want("stats")) out.stats = statsSection(ix);
  // "censuses" → summary rows for all ten; "censuses:<slug>" → that census
  // with its full member list (the prefetch lane's drill-down path).
  const censusSlugs = (sections ?? []).filter((s) => s.startsWith("censuses:")).map((s) => s.slice("censuses:".length));
  if (censusSlugs.length || want("censuses")) out.censuses = censusesSection(ix, censusSlugs);
  return out;
}

// ── atlas_get (single or bulk) ────────────────────────────────────────────────
function enrichGet(ix: Indexes, node: AtlasNode) {
  // Drop contentHash — a 64-char digest that's pure noise to a reader/LLM and
  // the single biggest wasted-bytes field per node.
  const { contentHash: _hash, ...rest } = node;
  return { ...rest, ancestors: ancestorChain(ix, node.id), ...livenessOf(ix, node.id) };
}

export function atlasGet(ix: Indexes, id: string | string[]): ToolResult {
  const isBulk = Array.isArray(id);
  const inputs = isBulk ? id : [id];

  if (!isBulk) {
    const node = resolveNode(ix, inputs[0]);
    if (!node) return { error: "Not found" };
    const enriched = enrichGet(ix, node);
    // Single-node calls have no wrapper envelope — the node itself IS the
    // response, so the hint (if any) rides alongside its own `liveness` field.
    return withLivenessHint(enriched, [enriched]);
  }

  const results = inputs.map((q) => {
    const node = resolveNode(ix, q);
    return node ? enrichGet(ix, node) : { query: q, error: "Not found" };
  });
  const { kept, truncated } = fitToBudget(results);
  const envelope = { count: kept.length, ...(truncated ? { requested: results.length, truncated: true, hint: TRUNCATION_HINT } : {}), results: kept };
  return withLivenessHint(envelope, kept);
}

// ── atlas_search (lexical | semantic | hybrid) ───────────────────────────────
export interface SearchArgs {
  query: string;
  k: number;
  type?: string;
  mode: "lexical" | "semantic" | "hybrid";
}

export async function atlasSearch(ix: Indexes, { query, k, type, mode }: SearchArgs): Promise<ToolResult> {
  const { phrases, casePhrases } = extractPhrases(query);
  const hasPhrases = phrases.length > 0 || casePhrases.length > 0;
  const fetchK = mode === "lexical" && !hasPhrases ? k : Math.min(k * 4, 200);

  const [lex, semResult] = await Promise.all([
    mode === "semantic" ? Promise.resolve([]) : Promise.resolve(runLexical(ix, query, type, fetchK)),
    mode === "lexical"
      ? Promise.resolve<SemanticResult>({ hits: [], skipped: null })
      // runSemantic no longer throws on a normal degraded-leg failure; this
      // catch is defensive-only, preserving the reason rather than the old
      // information-destroying `.catch(() => [])`.
      : runSemantic(ix, query, type, fetchK).catch((err) => ({ hits: [], skipped: (err as Error).message })),
  ]);
  const sem = attributeSemanticHits(query, lex, semResult.hits, ix, await buildLeafScorer(query, semResult.hits, ix));

  let merged: MergedHit[];
  if (mode === "lexical") merged = lex.map((h) => ({ id: h.id, sources: ["lexical"], rrf_score: 0, score: h.score }));
  else if (mode === "semantic") merged = sem.map((h) => ({ id: h.id, sources: ["semantic"], rrf_score: 0, score: h.score, via: h.via }));
  else merged = rrfMerge(lex, sem);
  merged = filterByType(merged, ix, type);

  const resolved = merged
    .map((m) => ({ m, n: ix.docMap.get(m.id) }))
    .filter((r): r is { m: MergedHit; n: AtlasNode } => !!r.n);

  const filtered = !hasPhrases
    ? resolved
    : resolved.filter(({ n }) => matchesPhrases(n.title, n.content, phrases, casePhrases));

  const results = filtered.slice(0, k).map(({ m, n }) => ({
    id: n.id,
    doc_no: n.doc_no,
    title: n.title,
    type: n.type,
    depth: n.depth,
    // Verbatim: this is a tool result an agent quotes from and is graded on.
    snippet: buildAgentSnippet(n.content, query),
    score: m.rrf_score || m.score,
    sources: m.sources,
    ...(m.via ? { via: m.via } : {}),
    ...livenessOf(ix, n.id),
  }));
  // Only present when the requested mode actually wanted a semantic leg (a
  // pure lexical search never runs one, so there's nothing to report skipping).
  const wantedSemantic = mode === "semantic" || mode === "hybrid";
  const envelope = {
    count: results.length,
    mode,
    phrase_filter: [...phrases, ...casePhrases],
    ...(wantedSemantic && semResult.skipped ? { semantic_skipped: semResult.skipped } : {}),
    results,
  };
  return withLivenessHint(envelope, results);
}

// ── atlas_get_address ─────────────────────────────────────────────────────────
export async function atlasGetAddress(ix: Indexes, address: string, chain?: string): Promise<ToolResult> {
  // normalizeAddress (EVM → lower, Solana base58 untouched) matches how sync
  // stores the key. A bare .toLowerCase() here would miss every case-sensitive
  // Solana row now that ingest preserves base58 case (review exec #2).
  const addr = normalizeAddress(address);
  const records = chain
    ? await sql`SELECT * FROM atlas_addresses WHERE address = ${addr} AND chain = ${chain}`
    : await sql`SELECT * FROM atlas_addresses WHERE address = ${addr}`;
  if (records.length === 0) return { error: "Address not found", address: addr };

  const enriched = records.map((r: Record<string, unknown>) => {
    // content_hash is an internal digest; atlas_sha is already in _meta.
    const { content_hash: _ch, atlas_sha: _as, ...rest } = r;
    const ent = r.entity_id ? ix.entityById.get(r.entity_id as string) : null;
    return {
      ...rest,
      entity: ent
        ? { slug: ent.slug, name: ent.name, entity_type: ent.entity_type, subtype: ent.subtype, defining_doc_id: ent.defining_doc_id }
        : null,
    };
  });

  // Edges referencing this address. Graph address nodes are keyed `<addr>:<chain>`
  // (per record), so look up each record's node. Include ALL in-edges regardless
  // of from_type — has_address is entity→address (the main one), located_at/
  // references are doc→address. Enrich endpoint fields from doc OR entity.
  const edges: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const nodeKeys = new Set(enriched.map((r: { address: string; chain: string }) => `${r.address}:${r.chain}`));
  nodeKeys.add(addr); // bare-address fallback
  for (const key of nodeKeys) {
    if (!ix.graph.hasNode(key)) continue;
    ix.graph.forEachInEdge(key, (_k, attrs, src) => {
      if (attrs.to_type !== "address") return;
      const dedup = `${src}|${attrs.edge_type}`;
      if (seen.has(dedup)) return;
      seen.add(dedup);
      const doc = attrs.from_type === "doc" ? ix.docMap.get(src) : undefined;
      const ent = attrs.from_type === "entity" ? ix.entityById.get(src) : undefined;
      edges.push({
        edge_type: attrs.edge_type,
        from_type: attrs.from_type,
        from_id: src,
        source_doc_nos: attrs.source_doc_nos,
        doc_no: doc?.doc_no ?? null,
        title: doc?.title ?? ent?.name ?? null,
        type: doc?.type ?? ent?.entity_type ?? null,
      });
    });
  }
  return { address: addr, records: enriched, edges };
}
