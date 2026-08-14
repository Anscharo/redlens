#!/usr/bin/env bun
/**
 * Retrieval eval for embedding-unit grouping, embed models, and rerankers.
 *
 *   pnpm eval:retrieval -- --backend tfidf
 *   pnpm eval:retrieval -- --backend tfidf --policies one_to_one,icd_params,breadcrumbs,directory_direct,hub_stubs
 *   pnpm eval:retrieval -- --backend tfidf --policies icd_params --caps 26,33
 *   pnpm eval:retrieval -- --backend tfidf --hybrid --collapse
 *   pnpm eval:retrieval -- --backend openrouter --models qwen/qwen3-embedding-8b,openai/text-embedding-3-large --subset 40
 *   pnpm eval:retrieval -- --backend openrouter --reuse-db --models qwen/qwen3-embedding-8b --policies one_to_one,breadcrumbs --subset 40
 *     ^ reuse a prod/staging DATABASE_URL's embeddings by content_hash (read-only); only cache-miss units are embedded
 *   pnpm eval:retrieval -- --rerank bm25
 *   pnpm eval:retrieval -- --prefix "Instruct: Given a web search query, retrieve relevant passages that answer the query\\nQuery: "
 *
 * Default backend is OpenRouter when OPENROUTER_API_KEY is set, else TF-IDF
 * (offline proxy for grouping architecture — not a substitute for the neural
 * bakeoff). Writes .cache/eval-retrieval.json.
 *
 * NEURAL result (2026-08-14, qwen/qwen3-embedding-8b, 155 queries, HYBRID
 * lex+semantic; baseline reused from a staging DB via --reuse-db). WINNER and
 * eval-backed candidate default (EMBED_GROUP_POLICY=icd_params_breadcrumbs +
 * EMBED_CRUMB_DEPTH=2); code default stays one_to_one so no deploy auto-re-embeds:
 *
 *   icd_params_breadcrumbs       recall@10 0.819  exact 0.677  disambig 0.700  mrr 0.578  — WINNER (only ~206 anchors re-embed)
 *   icd_params                   recall@10 0.813  exact 0.587  disambig 0.400  mrr 0.553  — grouping helps recall, not disambig
 *   one_to_one                   recall@10 0.742  exact 0.529  disambig 0.375  mrr 0.541  — current production
 *   breadcrumbs (depth2)         recall@10 0.652  exact 0.568  disambig 0.625            — disambig up, recall regresses
 *   icd_full_params_breadcrumbs  recall@10 0.781  exact 0.548  disambig 0.350  mrr 0.554  — full member prose+kv DILUTES the
 *                                distinctive param values (disambig/icd-param slices fall back to ~baseline); WORSE than the
 *                                kv-only fused. Lexical already indexes full prose, so keep the semantic anchor compact. Do not ship.
 *
 * Directional TF-IDF result (2026-08-14, 155 queries, distinctive-instance
 * disambiguation; offline proxy — it ranked breadcrumbs top, which the neural
 * run above overturned, so do NOT ship on the TF-IDF proxy alone):
 *
 *   breadcrumbs           recall@10 0.858  exact 0.858  disambig 1.000  — best first-stage
 *   icd_params            recall@10 0.845  exact 0.806  disambig 0.825  — beats 1:1; control 0.800 (no regression)
 *   directory_descendants recall@10 0.819  exact 0.794  disambig 0.900  — hub slice collapses (0.067)
 *   one_to_one            recall@10 0.684  exact 0.516  disambig 0.325  — current production
 *   hub_stubs             recall@10 0.671  — no win vs 1:1
 *   directory_direct      recall@10 0.632  — hurts ICD slices
 *   icd_params cap=26/33  identical to no-cap (ICD param trees sit under p95)
 *   hybrid (lex 1:1 + units)  no lift vs ANN-only on this proxy
 *   bm25 rerank@50→10     icd_params 0.916 / disambig 1.000 — TF-IDF+BM25 artifact; do not ship
 *
 * Model bakeoff: `--backend openrouter --models … --subset 40`. Do not flip
 * EMBED_MODEL (grouping policy, not the model, is the win above).
 */
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types.ts";
import { config } from "../../src/server/config.ts";
import { embedBatch, embedQuery } from "../../src/server/retrieval/embed.ts";
import {
  buildUnits,
  GROUP_POLICIES,
  rewriteSemanticHit,
  isDocNoDescendant,
  type GroupPolicy,
  type EmbedUnit,
} from "../../src/server/retrieval/embed-units.ts";
import { generateRetrievalQueries, type RetrievalQuery } from "./eval-retrieval-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));

const POLICIES = (flag("policies")[0]?.split(",") ?? ["one_to_one", "icd_params", "breadcrumbs", "directory_direct", "hub_stubs"]) as GroupPolicy[];
const CAP = flag("cap")[0] ? Number(flag("cap")[0]) : undefined;
const CAPS = (flag("caps")[0]?.split(",") ?? []).map(Number).filter((n) => Number.isFinite(n));
const BACKEND = (flag("backend")[0] ?? (config.openrouterApiKey ? "openrouter" : "tfidf")) as "tfidf" | "openrouter";
const MODELS = flag("models")[0]?.split(",") ?? [config.embedModel];
const RERANK = (flag("rerank")[0] ?? "none") as "none" | "bm25";
const COLLAPSE = argv.includes("--collapse");
const HYBRID = argv.includes("--hybrid");
const REUSE_DB = argv.includes("--reuse-db");
const CRUMB_DEPTH = flag("crumb-depth")[0] ? Number(flag("crumb-depth")[0]) : undefined;
const PREFIX = flag("prefix")[0] ?? "";
const SUBSET = flag("subset")[0] ? Number(flag("subset")[0]) : undefined;
const K = Number(flag("k")[0] ?? 10);
const RERANK_POOL = 50;
const OUT = flag("out")[0] ?? path.join(ROOT, ".cache", "eval-retrieval.json");

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

function idfMap(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const toks of docs) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [t, c] of df) idf.set(t, Math.log((n + 1) / (c + 1)) + 1);
  return idf;
}

function tfidfVec(toks: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  const v = new Map<string, number>();
  let n = 0;
  for (const [t, c] of tf) {
    const w = (c / toks.length) * (idf.get(t) ?? 0);
    v.set(t, w);
    n += w * w;
  }
  const norm = Math.sqrt(n) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  return v;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, w] of small) s += w * (large.get(t) ?? 0);
  return s;
}

function bm25Rerank(query: string, pool: { id: string; text: string; score: number }[]): { id: string; text: string; score: number }[] {
  const q = tokenize(query);
  return [...pool]
    .map((p) => {
      const toks = tokenize(p.text);
      let s = 0;
      for (const t of q) s += toks.includes(t) ? 1 : 0;
      return { ...p, score: s + p.score * 0.01 };
    })
    .sort((a, b) => b.score - a.score);
}

function metrics(ranked: string[][], queries: RetrievalQuery[], docMap: Map<string, AtlasNode>) {
  let rec = 0;
  let mrr = 0;
  let exactRec = 0;
  let exactMrr = 0;
  let disN = 0;
  let disExact = 0;
  const bySlice: Record<string, { n: number; recall: number; mrr: number; exact: number; exactMrr: number }> = {};
  const hitAt = (hits: string[], rel: Set<string>, ancestors: boolean) => {
    for (let i = 0; i < hits.length; i++) {
      const id = hits[i]!;
      if (rel.has(id)) return i;
      if (!ancestors) continue;
      const n = docMap.get(id);
      if (!n) continue;
      for (const r of rel) {
        const leaf = docMap.get(r);
        if (leaf && isDocNoDescendant(leaf.doc_no, n.doc_no)) return i;
      }
    }
    return -1;
  };
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]!;
    const rel = new Set(q.relevant);
    const hits = ranked[i]!;
    const found = hitAt(hits, rel, true);
    const exact = hitAt(hits, rel, false);
    const hit = found >= 0;
    if (hit) rec++;
    if (hit) mrr += 1 / (found + 1);
    if (exact >= 0) {
      exactRec++;
      exactMrr += 1 / (exact + 1);
    }
    if (q.slice === "icd-disambiguation") {
      disN++;
      if (exact >= 0) disExact++;
    }
    const sl = q.slice;
    const b = bySlice[sl] ?? { n: 0, recall: 0, mrr: 0, exact: 0, exactMrr: 0 };
    b.n++;
    if (hit) b.recall++;
    if (hit) b.mrr += 1 / (found + 1);
    if (exact >= 0) {
      b.exact++;
      b.exactMrr += 1 / (exact + 1);
    }
    bySlice[sl] = b;
  }
  const n = queries.length || 1;
  const slices: Record<string, { n: number; recall_at_k: number; mrr: number; exact_recall_at_k: number; exact_mrr: number }> = {};
  for (const [sl, b] of Object.entries(bySlice)) {
    slices[sl] = {
      n: b.n,
      recall_at_k: b.recall / b.n,
      mrr: b.mrr / b.n,
      exact_recall_at_k: b.exact / b.n,
      exact_mrr: b.exactMrr / b.n,
    };
  }
  return {
    n: queries.length,
    recall_at_k: rec / n,
    mrr: mrr / n,
    exact_recall_at_k: exactRec / n,
    exact_mrr: exactMrr / n,
    disambiguation_accuracy: disN ? disExact / disN : null,
    slices,
  };
}

async function embedUnitsOpenRouter(units: EmbedUnit[], model: string): Promise<number[][]> {
  const prev = config.embedModel;
  config.embedModel = model;
  try {
    const out: number[][] = [];
    for (let i = 0; i < units.length; i += 50) {
      const slice = units.slice(i, i + 50);
      out.push(...(await embedBatch(slice.map((u) => u.text))));
    }
    return out;
  } finally {
    config.embedModel = prev;
  }
}

function parseVecLiteral(s: string): number[] {
  return s.replace(/^\[|\]$/g, "").split(",").map(Number);
}

// Read-only: pull embeddings from DATABASE_URL keyed by content_hash. A unit
// whose embed TEXT is byte-identical to an already-embedded doc (same
// content_hash) reuses that vector instead of paying to re-embed it — e.g. the
// one_to_one baseline is ~fully covered by a prod/staging DB, and only the docs
// a grouping/breadcrumb policy actually rewrites are cache misses. content_hash
// keys the text, NOT the model, so the DB must have been embedded with the SAME
// model as `--models` (mixing embedding spaces silently wrecks rankings) —
// hence --reuse-db is single-model and never writes to the DB.
async function loadCachedVectors(): Promise<Map<string, number[]>> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("--reuse-db requires DATABASE_URL (a read-only embedding cache)");
  const { SQL } = await import("bun");
  const sql = new SQL({ url, max: 2 });
  const out = new Map<string, number[]>();
  try {
    const rows = (await sql`SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding FROM atlas_doc_embeddings`) as {
      content_hash: string;
      embedding: string;
    }[];
    for (const r of rows) out.set(r.content_hash, parseVecLiteral(r.embedding));
  } finally {
    await sql.end();
  }
  return out;
}

// Embed only the distinct miss-hashes (dedup identical texts across units),
// returning hash→vector. Progress logs every batch since a big miss set (a
// breadcrumb policy rewrites most docs) is otherwise silent for minutes.
async function embedMissesByHash(units: EmbedUnit[], cache: Map<string, number[]>, model: string): Promise<Map<string, number[]>> {
  const missByHash = new Map<string, string>();
  for (const u of units) if (!cache.has(u.hash)) missByHash.set(u.hash, u.text);
  const entries = [...missByHash.entries()];
  const fresh = new Map<string, number[]>();
  const prev = config.embedModel;
  config.embedModel = model;
  try {
    for (let i = 0; i < entries.length; i += 50) {
      const slice = entries.slice(i, i + 50);
      const vecs = await embedBatch(slice.map(([, text]) => text));
      slice.forEach(([hash], j) => fresh.set(hash, vecs[j]!));
      console.log(`    embedded ${Math.min(i + 50, entries.length)}/${entries.length} distinct misses`);
    }
  } finally {
    config.embedModel = prev;
  }
  return fresh;
}

function rankTfidf(query: string, units: EmbedUnit[], vecs: Map<string, number>[], idf: Map<string, number>, k: number): { id: string; text: string; score: number }[] {
  const qv = tfidfVec(tokenize(query), idf);
  return units
    .map((u, i) => ({ id: u.anchorId, text: u.text, score: cosine(qv, vecs[i]!) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

function attributeRank(
  query: string,
  ranked: { id: string; text: string; score: number }[],
  units: EmbedUnit[],
  docMap: Map<string, AtlasNode>,
  k: number,
  lexHits: { id: string; doc_no: string }[] = [],
): string[] {
  const byAnchor = new Map(units.map((u) => [u.anchorId, u]));
  const lex =
    lexHits.length > 0
      ? lexHits
      : COLLAPSE
        ? ranked.map((r) => {
            const n = docMap.get(r.id);
            return { id: r.id, doc_no: n?.doc_no ?? "" };
          })
        : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of ranked) {
    const u = byAnchor.get(r.id);
    const rw = rewriteSemanticHit(query, r.id, u?.memberIds, lex, docMap);
    if (seen.has(rw.id)) continue;
    seen.add(rw.id);
    ids.push(rw.id);
    if (ids.length >= k) break;
  }
  return ids;
}

function rrfFuse(lexIds: string[], semIds: string[], k: number): string[] {
  const acc = new Map<string, number>();
  const bump = (ids: string[]) => {
    ids.forEach((id, rank) => acc.set(id, (acc.get(id) ?? 0) + 1 / (60 + rank + 1)));
  };
  bump(lexIds);
  bump(semIds);
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

function pctTimes(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

const docsFile = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as {
  nodes: Record<string, AtlasNode>;
};
const docs = Object.values(docsFile.nodes);
const docMap = new Map(docs.map((d) => [d.id, d]));
let queries = generateRetrievalQueries(docs);
if (SUBSET && Number.isFinite(SUBSET)) queries = queries.slice(0, SUBSET);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

if (BACKEND === "openrouter" && !config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set — use --backend tfidf or set the key.");
  process.exit(1);
}

interface ArmResult {
  policy: string;
  model: string;
  backend: string;
  rerank: string;
  collapse: boolean;
  hybrid: boolean;
  prefix: boolean;
  cap: number | null;
  crumb_depth: number | null;
  units: number;
  query_embed_ms: { p50: number | null; p95: number | null };
  metrics: ReturnType<typeof metrics>;
}

const results: ArmResult[] = [];
const capList = CAPS.length > 0 ? CAPS : [CAP !== undefined && !Number.isNaN(CAP) ? CAP : null];

let cachedVectors: Map<string, number[]> | null = null;
if (REUSE_DB) {
  if (BACKEND !== "openrouter") {
    console.error("--reuse-db reuses neural vectors; pass --backend openrouter.");
    process.exit(1);
  }
  if (MODELS.length !== 1) {
    console.error("--reuse-db is single-model (the DB was embedded with one model); pass exactly one --models value matching it.");
    process.exit(1);
  }
  console.log(`loading cached embeddings from DATABASE_URL (read-only) — must be embedded with ${MODELS[0]}…`);
  cachedVectors = await loadCachedVectors();
  console.log(`  cache: ${cachedVectors.size} distinct content_hashes`);
}

let lexUnits: EmbedUnit[] | null = null;
let lexIdf: Map<string, number> | null = null;
let lexVecs: Map<string, number>[] | null = null;
if (HYBRID) {
  lexUnits = buildUnits(docs, "one_to_one");
  const toks = lexUnits.map((u) => tokenize(u.text));
  lexIdf = idfMap(toks);
  lexVecs = toks.map((t) => tfidfVec(t, lexIdf!));
}

for (const policy of POLICIES) {
  if (!GROUP_POLICIES.includes(policy)) {
    console.warn(`skip unknown policy ${policy}`);
    continue;
  }
  for (const cap of capList) {
    const opts = { ...(cap != null ? { cap } : {}), ...(CRUMB_DEPTH ? { crumbDepth: CRUMB_DEPTH } : {}) };
    const units = buildUnits(docs, policy, opts);
    console.log(
      `policy=${policy} cap=${cap ?? "none"}${CRUMB_DEPTH ? ` crumbDepth=${CRUMB_DEPTH}` : ""} units=${units.length} backend=${BACKEND}`,
    );

    for (const model of MODELS) {
      let tfidfVecs: Map<string, number>[] | null = null;
      let idf: Map<string, number> | null = null;
      let neural: number[][] | null = null;
      if (BACKEND === "tfidf") {
        const toks = units.map((u) => tokenize(u.text));
        idf = idfMap(toks);
        tfidfVecs = toks.map((t) => tfidfVec(t, idf!));
      } else if (REUSE_DB && cachedVectors) {
        const fresh = await embedMissesByHash(units, cachedVectors, model);
        let reused = 0;
        neural = units.map((u) => {
          const hit = cachedVectors!.get(u.hash);
          if (hit) {
            reused++;
            return hit;
          }
          return fresh.get(u.hash)!;
        });
        console.log(`  ${policy}: reused ${reused}/${units.length} from DB, embedded ${units.length - reused} with ${model}`);
      } else {
        console.log(`  embedding ${units.length} units with ${model}…`);
        neural = await embedUnitsOpenRouter(units, model);
      }

      const ranked: string[][] = [];
      const qEmbedMs: number[] = [];
      for (const q of queries) {
        const qText = BACKEND === "openrouter" && PREFIX ? `${PREFIX}${q.query}` : q.query;
        let pool: { id: string; text: string; score: number }[];
        const poolK = RERANK === "bm25" || HYBRID ? RERANK_POOL : K;
        if (BACKEND === "tfidf") {
          pool = rankTfidf(q.query, units, tfidfVecs!, idf!, poolK);
        } else {
          const prev = config.embedModel;
          config.embedModel = model;
          const t0 = performance.now();
          let qv: number[];
          try {
            qv = await embedQuery(qText);
          } finally {
            config.embedModel = prev;
          }
          qEmbedMs.push(performance.now() - t0);
          pool = units
            .map((u, i) => {
              const v = neural![i]!;
              let s = 0;
              for (let j = 0; j < qv.length; j++) s += qv[j]! * v[j]!;
              return { id: u.anchorId, text: u.text, score: s };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, poolK);
        }
        if (RERANK === "bm25") pool = bm25Rerank(q.query, pool).slice(0, K);
        else pool = pool.slice(0, HYBRID ? RERANK_POOL : K);

        let lexHits: { id: string; doc_no: string }[] = [];
        if (HYBRID && lexUnits && lexVecs && lexIdf) {
          const lexPool = rankTfidf(q.query, lexUnits, lexVecs, lexIdf, K);
          lexHits = lexPool.map((r) => {
            const n = docMap.get(r.id);
            return { id: r.id, doc_no: n?.doc_no ?? "" };
          });
          const semIds = attributeRank(q.query, pool, units, docMap, K, lexHits);
          ranked.push(rrfFuse(lexHits.map((h) => h.id), semIds, K));
        } else {
          ranked.push(attributeRank(q.query, pool.slice(0, K), units, docMap, K, lexHits));
        }
      }

      const m = metrics(ranked, queries, docMap);
      results.push({
        policy,
        model: BACKEND === "tfidf" ? "tfidf" : model,
        backend: BACKEND,
        rerank: RERANK,
        collapse: COLLAPSE || HYBRID,
        hybrid: HYBRID,
        prefix: Boolean(PREFIX),
        cap: cap,
        crumb_depth: CRUMB_DEPTH ?? null,
        units: units.length,
        query_embed_ms: { p50: pctTimes(qEmbedMs, 50), p95: pctTimes(qEmbedMs, 95) },
        metrics: m,
      });
      const dis = m.disambiguation_accuracy == null ? "-" : m.disambiguation_accuracy.toFixed(3);
      console.log(
        `  ${policy} cap=${cap ?? "none"} ${BACKEND === "tfidf" ? "tfidf" : model} rerank=${RERANK} hybrid=${HYBRID} recall@${K}=${m.recall_at_k.toFixed(3)} exact=${m.exact_recall_at_k.toFixed(3)} disambig=${dis} mrr=${m.mrr.toFixed(3)}`,
      );
      for (const [sl, s] of Object.entries(m.slices)) {
        console.log(
          `    ${sl}: n=${s.n} recall=${s.recall_at_k.toFixed(3)} exact=${s.exact_recall_at_k.toFixed(3)} mrr=${s.mrr.toFixed(3)}`,
        );
      }
    }
  }
}

const report = {
  generated_at: new Date().toISOString(),
  backend: BACKEND,
  k: K,
  hybrid: HYBRID,
  prefix: PREFIX || null,
  query_count: queries.length,
  queries: queries.map((q) => ({ id: q.id, slice: q.slice, query: q.query })),
  results,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`wrote ${OUT}`);
