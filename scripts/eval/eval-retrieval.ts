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
 * ══ CURRENT RESULT (2026-08-18, rewritten paraphrased query set, 179 queries) ══
 * Neural, hybrid, --reuse-db, policy=icd_params_breadcrumbs. Breadcrumb strategy has
 * NO MEASURABLE EFFECT:
 *
 *   strategy         recall  exact  disambig   mrr
 *   full              0.899  0.564    0.275   0.698
 *   nearest:2         0.899  0.564    0.275   0.704
 *   raw:distinct:3    0.899  0.570    0.300   0.698
 *
 * full and nearest:2 are IDENTICAL on recall/exact/disambig; raw:distinct:3 leads by
 * ONE query of 40. On the old query set the same comparison showed full beating
 * nearest:2 by 11 of 40 (0.825 vs 0.550) — that effect was entirely an artifact of
 * lexical leakage plus a disambiguation slice that was 36/40 one product family.
 * RETRACTED: "EMBED_CRUMB_DEPTH=2 is harmful" does not reproduce. The setting does
 * not measurably matter; unset remains the default only because it is what the code
 * does with no config.
 *
 * POLICY COMPARISON on the same rewritten set (2026-08-18, neural+hybrid):
 *
 *                        recall  exact  disambig   mrr
 *   icd_params_bc         0.899  0.564    0.275   0.697
 *   kv_records_bc         0.911  0.564    0.275   0.693
 *   kv-record slice       0.542 -> 0.625 recall,  0.333 -> 0.333 exact
 *   icd-disambiguation / icd-param / directory / hub / control:  IDENTICAL
 *
 * The earlier "trade" verdict does NOT reproduce: the -2-queries-each ICD cost is
 * gone, both slices tie exactly. kv_records_breadcrumbs is now neutral-to-slightly
 * positive — no measured downside anywhere, +2 of 24 recall on its target slice.
 * That is a weak positive, not a win: at n=24 it is two queries.
 *
 * THE INFORMATIVE PART: kv-record recall rose (+0.083) while kv-record EXACT did not
 * move at all (0.333 both). Folding gets retrieval to the right RECORD; it does not
 * convert that into landing on the right LEAF. Measured directly
 * (scripts/aux/leaf-attribution-experiment.ts): pickLeaf is ~34% accurate, which
 * matches icd-param exact (0.375) almost exactly. Retrieval reaches the right group
 * for essentially EVERY ICD query (recall 1.000) and attribution then discards ~2/3
 * of them. LEAF ATTRIBUTION, NOT GROUPING, IS THE DOMINANT BOTTLENECK.
 *
 * Attribution methods measured on the 98 queries whose target is folded
 * (scripts/aux/leaf-attribution-experiment.ts re-runs this for ~100 embeddings):
 *
 *                            overall  icd-disambig  icd-param  kv-record   cost
 *   lexical (current)          34%        30%          43%       22%      free
 *   cosine (query·leaf)        31%        33%          15%       61%      free
 *   RRF fusion of the two      20%        10%          13%       61%      free
 *   projection, query-side     35%        38%          48%        0%      free
 *   RESIDUAL query             53%        58%          50%       50%      +1 embed
 *
 * WINNER: residual — strip the anchor's own title from the query, then take cosine
 * against the members. +19 points over the current lexical scorer.
 *
 * SHIPPABLE FORM: one SHARED residual per query instead of one per grouped hit. Strip
 * the union of the top-K retrieved anchor titles (ranked by cosine to the query, i.e.
 * what the semantic leg returns) and reuse that single residual for every group:
 *
 *   top-1  40%    top-10 50%    top-50 46%
 *   top-5  45%    top-20 51%  <- peak
 *
 * 51% vs the 53% per-hit oracle, at ONE extra embed per query regardless of how many
 * groups were hit. Accuracy RISES with K up to ~20 because the top anchors are
 * similar instances whose titles jointly cover the instance-name vocabulary better
 * than any single title does; it falls again by K=50 as genuine question words start
 * being stripped. RERANK_POOL is already 50 and K is 10, so the anchors are on hand.
 *
 * Two free variants are dead ends for structural reasons, not tuning reasons:
 * query-side projection removes the anchor DIRECTION from the query vector, which
 * makes the anchor mathematically unselectable — hence kv-record 0%, where the target
 * often IS the anchor. (A member-side projection variant was also tried; it
 * degenerates to always picking the anchor, so its numbers are an artifact of the
 * experiment and are not reported.)
 *
 * They fail on OPPOSITE slices. Cosine fixes precisely the semantic misses lexical
 * cannot ("which chain …" picking "Off-chain Operational Parameters" over "Network";
 * "what asset …" picking "transferAsset Rate Limits" over "Token").
 *
 * WHY cosine collapses on icd-param — two plausible explanations were MEASURED AND
 * REJECTED before the real one was found. It is not that those leaves are thinner
 * (median member text is ~80 chars in all three slices) and not that their siblings
 * are more alike (mean pairwise sibling cosine ~0.57 in all three). The actual cause,
 * from dumping the ranked members: THE QUERY NAMES ITS INSTANCE, and that long name
 * dominates the embedding. For "which chain does Ethereum Mainnet - Fluid sUSDS
 * ERC4626 Vault run on", the top member is the anchor itself (0.851) and "Target
 * Protocol: Fluid Finance" (0.820) outranks the correct "Network: Ethereum Mainnet"
 * (0.808) — members win by echoing the instance name, not by answering the question.
 * Inside a group the instance name discriminates NOTHING; only the rest of the
 * question does. Hence the residual-query variant measured below.
 *
 * RRF fusion of lexical+cosine was also measured and is much WORSE (10-13% on the ICD
 * slices): rank fusion assumes both inputs are informative, but lexical scores here
 * are frequently all-zero or tied, so its ranking is noise given equal weight.
 *
 * Do NOT simply swap lexical for cosine — it is worse overall. Purely lexical tuning
 * is also a dead end: word-boundary matching, stopword removal and within-group IDF
 * all measured WORSE than the current code (19-24% vs 34%) in an identical harness.
 *
 * The rewritten set also proves it measures the right thing. * The rewritten set also proves it measures the right thing. Same policy, same arms:
 *   OLD set:  tfidf 0.804/0.721/0.825   vs neural 0.771/0.648/0.825  -> TF-IDF WON
 *   NEW set:  tfidf 0.866/0.480/0.175   vs neural 0.899/0.564/0.275  -> neural wins
 * A set that a bag-of-words ranker beats a 4096-dim embedding model on was measuring
 * string matching. The new one separates them, which is the whole point.
 *
 * Honest absolute baseline on paraphrased questions: instance disambiguation sits at
 * 0.275-0.300 (11-12 of 40), and kv-record at 0.542 recall / 0.333 exact. THAT is
 * where the headroom is — not in breadcrumb tuning, which is now measured flat.
 *
 * ⚠⚠ ALL RESULTS BELOW PREDATE THE 2026-08-18 QUERY-SET REWRITE AND ARE PROVISIONAL.
 * Every number recorded here was produced by a query set with two defects found on
 * 2026-08-18:
 *   1. LEXICAL LEAKAGE — queries were built as `${instance} ${field} ${value}`, so 39
 *      of 40 icd-param queries contained the answer verbatim (mean overlap ~1.00).
 *      The set largely measured string matching, which BM25 already wins.
 *   2. NO BREADTH — `slice(0, 4)` gave 36 of 40 disambiguation queries to ONE family
 *      (SparkLend x 4 tokens, 8 distinct instances total), and 39 of 40 icd-param
 *      queries to a single field name. n=40 bought far less evidence than it looked.
 *   3. The hub slice was 15 copies of one unanswerable question ("which documents
 *      exist under Primitive Hub Document" — every hub shares that title), which is
 *      why it sat at exactly 0.400 in every arm ever run.
 * The set is now paraphrased (eval-retrieval-paraphrase.ts), strided across families,
 * deduplicated, and reports per-slice lexical overlap on every run. TREAT EVERY
 * CONCLUSION BELOW AS OPEN until re-measured: the crumb-depth verdict, the raw-chain
 * verdict, the kv_records trade, and the policy winner alike.
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
 * ⚠ SETTLED 2026-08-18: LEAVE EMBED_CRUMB_DEPTH UNSET (full chain).
 * Seven-strategy sweep, icd_params_breadcrumbs, identical 179-query stratified set,
 * neural+hybrid, --reuse-db. Only the crumb strategy differs:
 *
 *   strategy           recall  exact  disambig   mrr    units re-embedded
 *   full               0.771   0.648   0.825    0.563        230
 *   nearest:4          0.771   0.648   0.825    0.563          5
 *   root:2+nearest:3   0.771   0.648   0.825    0.563          0   (identical text to full)
 *   nearest:3          0.771   0.648   0.825    0.562         38
 *   root:1+nearest:2   0.771   0.648   0.825    0.562         38
 *   distinct:3         0.771   0.648   0.825    0.562         31
 *   nearest:2          0.765   0.581   0.550    0.561        143   <- the ONLY loser
 *
 * WHY they tie: ICD anchors have only 2-5 non-generic ancestors (87 have 2, 105
 * have 3, 33 have 4, 5 have 5). "Keep 3+" therefore truncates almost nothing and
 * reduces to the full chain; root:2+nearest:3 re-embedded ZERO units because its
 * text was byte-identical to full. Only nearest:2 cuts deeply enough to matter, and
 * it loses 11 of 40 disambiguation queries.
 *
 * So the swept variable turned out to be HOW MUCH you truncate, not WHICH ancestors
 * you keep — the rarity-based distinct:N never got a real test here for lack of
 * ancestors to choose among. It would be exercised by a breadcrumbs-on-every-doc
 * policy: corpus-wide 3,849 docs have >=5 ancestors (max 8+), unlike ICD anchors.
 *
 * NOISE FLOOR (revised): with cross-arm vector reuse (identical text embedded once
 * per run), the six tying arms agree to 0.001-0.002 mrr. Before that fix, two runs of
 * the SAME config disagreed by 0.011 because each re-embedded the same strings and
 * the provider is not bit-deterministic. Treat sub-0.005 deltas as noise.
 *
 * kv_records_breadcrumbs run (2026-08-17, 179 queries, neural+hybrid). NOT
 * COMPARABLE to the 2026-08-14 numbers above — the query set grew 155→179 (the new
 * kv-record slice), buildEmbedText now strips markdown links so every embed text
 * changed, and the atlas advanced (c077dc3f→8cba8156). Only the within-run arm
 * comparison is valid. It also ran WITHOUT `--crumb-depth 2`, so both arms used
 * full-chain crumbs — i.e. it did not evaluate the shipping configuration:
 *
 *   kv_records_breadcrumbs  recall@10 0.765  exact 0.682  disambig 0.825  mrr 0.549
 *   icd_params_breadcrumbs  recall@10 0.754  exact 0.648  disambig 0.825  mrr 0.542
 *
 * kv dominates or ties every slice (kv-record 0.500 vs 0.417, icd-param exact 0.500
 * vs 0.400, control/hub/directory/disambig identical) — but **the slice did not test
 * the policy**: only 3 of the 24 kv-record queries target a doc whose treatment
 * DIFFERS between the arms. The rest are either scaffolding the generic pass
 * deliberately rejects, or already folded by the ICD pass, which runs in BOTH arms.
 * So +0.011 overall is unattributable at this power, and the icd-param delta is the
 * generic pass's diffuse index effect (2,323 fewer competing vectors) or noise at
 * n=40 — NOT the ICD sibling-container widening, which is common to both arms.
 * WINNER DESIGNATION UNCHANGED; adoption of kv_records_breadcrumbs is DEFERRED
 * pending a discriminating slice (stratify ~half the queries onto folded targets)
 * re-run with `--crumb-depth 2`.
 *
 * RE-RUN with the stratified slice (12/24 arm-differential) + `--crumb-depth 2`
 * (2026-08-17). This one IS interpretable, and the verdict is a TRADE, not a win:
 *
 *   icd_params_breadcrumbs  recall 0.765  exact 0.581  disambig 0.550  mrr 0.559
 *   kv_records_breadcrumbs  recall 0.760  exact 0.581  disambig 0.500  mrr 0.546
 *
 *   kv-record          0.542→0.667 recall, 0.250→0.417 exact   ← the designed win
 *   icd-disambiguation 0.950→0.900 recall, 0.550→0.500 exact
 *   icd-param          0.625→0.575 recall, 0.375→0.325 exact
 *   directory/hub/control  identical
 *
 * The generic pass buys kv-record retrieval (+3 recall / +4 exact of 24) and pays for
 * it on the ICD slices (−2 of 40 each), netting FLAT overall (recall −0.005, exact
 * tie, mrr −0.013). So: adopt only if kv-record traffic matters more than ICD
 * disambiguation; on these numbers it is not a general improvement. DO NOT ADOPT as a
 * default yet.
 *
 * Next experiment for the ICD regression: only 39 of the 696 generic units (144 docs,
 * ~6%) are anchored INSIDE an ICD subtree — mostly `Routine Protocol` and
 * `Instance-specific Operational Processes`. Excluding ICD-descendant roots from the
 * generic pass tests whether the ICD cost is caused by encroachment or is just the
 * diffuse index effect of removing 2,875 vectors. At n=40 a 2-query move is also
 * plainly within noise, so treat the ICD deltas as weak evidence either way.
 *
 * The hub slice (0.400 in both arms) did not test the "hub_stubs lost on its text
 * builder" hypothesis either: hubs have one real value among ~5 placeholder leaves,
 * so KV_MIN_VALUES=2 + the 60% value-share gate exclude them structurally (4 of 141
 * hubs fold). That hypothesis remains UNTESTED — it needs a hub-specific rule that
 * folds the lone status value, as its own arm.
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
import { lexicalOverlap } from "./eval-retrieval-paraphrase.ts";

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
// Sweep breadcrumb selection strategies (comma-separated, see CRUMB_STRATEGIES in
// embed-units.ts). Cheap to sweep: only ~143 units' text depends on the crumb, so
// every extra strategy costs ~143 embeddings and the rest reuse cached vectors.
// No offline proxy predicts the winner — full vs nearest:2 are structurally
// identical (same duplicate count, same same-title separation) yet differ by 11 of
// 40 disambiguation queries — so this has to be run neurally.
const CRUMB_STRATS = flag("crumb-strategies")[0]?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
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
// a grouping/breadcrumb policy actually rewrites are cache misses.
// NOTE: any change to buildEmbedText's definition invalidates the cache for the
// docs it actually alters — measured 2026-08-17, adding link-stripping took the
// baseline hit rate from 99.4% to 84.2% (1,730 one-time misses) against a DB
// embedded beforehand. Unchanged text still hits, so re-baseline once and it
// returns to ~99%. content_hash
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

// Arm-differential coverage. A slice whose targets are treated identically by both
// policies cannot measure the difference between them, however good its metrics look:
// the 2026-08-17 run scored kv-record 0.417→0.500 on 3/24 differential queries and was
// therefore uninformative. Print it up front so that failure mode is never silent.
// Lexical leakage: how much of each question is already present verbatim in its own
// answer. High means the question is a restatement of the document, so BM25 wins it
// outright and the run says nothing about semantic retrieval. Until 2026-08-18 the
// icd-param slice sat at ~1.00 (39 of 40 queries contained the answer text) and every
// conclusion drawn from it was really a conclusion about string matching. Printed per
// slice so that can never quietly return.
{
  const bySlice = new Map<string, { sum: number; n: number; ctrl: boolean }>();
  for (const q of queries) {
    const target = docMap.get(q.relevant[0] ?? "");
    if (!target) continue;
    const ov = lexicalOverlap(q.query, `${target.title} ${target.content ?? ""}`);
    const b = bySlice.get(q.slice) ?? { sum: 0, n: 0, ctrl: false };
    b.sum += ov;
    b.n++;
    b.ctrl = b.ctrl || q.lexicalControl === true;
    bySlice.set(q.slice, b);
  }
  const parts = [...bySlice.entries()].map(([sl, b]) => {
    const v = (b.sum / b.n).toFixed(2);
    return `${sl} ${v}${b.ctrl ? "*" : ""}`;
  });
  console.log(`lexical overlap by slice (* = deliberate lexical control): ${parts.join("  ")}`);
  const dupes = queries.length - new Set(queries.map((q) => q.query)).size;
  if (dupes > 0) console.log(`  ⚠ ${dupes} duplicate query strings — same question, different answers, unanswerable`);
}

const differentialQs = queries.filter((q) => q.differential !== undefined);
if (differentialQs.length) {
  const n = differentialQs.filter((q) => q.differential).length;
  console.log(
    `arm-differential coverage: ${n}/${differentialQs.length} flagged queries target docs the arms treat differently` +
      (n < differentialQs.length / 4 ? "  ⚠ too low to attribute any delta to the policy" : ""),
  );
}

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
  crumb_strategy: string | null;
  units: number;
  query_embed_ms: { p50: number | null; p95: number | null };
  metrics: ReturnType<typeof metrics>;
}

const results: ArmResult[] = [];
const capList = CAPS.length > 0 ? CAPS : [CAP !== undefined && !Number.isNaN(CAP) ? CAP : null];

let cachedVectors: Map<string, number[]> | null = null;
// Per-model store of vectors embedded during THIS run, shared across arms so an
// unchanged unit text is embedded once no matter how many arms include it.
const freshByModel = new Map<string, Map<string, number[]>>();
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
   for (const strat of CRUMB_STRATS.length ? CRUMB_STRATS : [null]) {
    const opts = {
      ...(cap != null ? { cap } : {}),
      ...(CRUMB_DEPTH ? { crumbDepth: CRUMB_DEPTH } : {}),
      ...(strat ? { crumbStrategy: strat } : {}),
    };
    const units = buildUnits(docs, policy, opts);
    console.log(
      `policy=${policy} cap=${cap ?? "none"}${strat ? ` crumb=${strat}` : CRUMB_DEPTH ? ` crumbDepth=${CRUMB_DEPTH}` : ""} units=${units.length} backend=${BACKEND}`,
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
        // Vectors embedded for an earlier arm are reused by later ones, keyed per
        // model. Sweeping crumb strategies re-uses most anchors verbatim (only ~143
        // of 230 change), so without this each arm re-pays for identical text — and
        // re-embedding the same string twice also reintroduces the ~0.01 mrr wobble
        // that made two identical configs disagree across runs.
        const modelCache = freshByModel.get(model) ?? new Map<string, number[]>();
        freshByModel.set(model, modelCache);
        const lookup = new Map([...cachedVectors, ...modelCache]);
        const fresh = await embedMissesByHash(units, lookup, model);
        for (const [h, v] of fresh) modelCache.set(h, v);
        let reused = 0;
        neural = units.map((u) => {
          const hit = lookup.get(u.hash);
          if (hit) {
            reused++;
            return hit;
          }
          return fresh.get(u.hash)!;
        });
        console.log(`  ${policy}: reused ${reused}/${units.length} (DB + earlier arms), embedded ${units.length - reused} with ${model}`);
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
        crumb_strategy: strat,
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
}

const report = {
  generated_at: new Date().toISOString(),
  backend: BACKEND,
  k: K,
  hybrid: HYBRID,
  prefix: PREFIX || null,
  query_count: queries.length,
  queries: queries.map((q) => ({
    id: q.id,
    slice: q.slice,
    query: q.query,
    ...(q.differential !== undefined ? { differential: q.differential } : {}),
  })),
  results,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`wrote ${OUT}`);
