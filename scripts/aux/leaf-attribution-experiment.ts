#!/usr/bin/env bun
/**
 * Does SEMANTIC leaf attribution beat the lexical one?
 *
 *   bun scripts/aux/leaf-attribution-experiment.ts
 *
 * WHY. On the 2026-08-18 paraphrased query set, retrieval puts the right group in the
 * top 10 for essentially every ICD query (recall 1.000) but only lands on the right
 * DOCUMENT 27-38% of the time. The gap is `pickLeaf` in embed-units.ts, which scores
 * members by counting query terms in their title/content. Measured directly it is
 * ~34% accurate, and its failures are semantic, not lexical: "which chain does X run
 * on" picks "Off-chain Operational Parameters" over "Network"; "what asset does X use"
 * picks "Asset Supplied By …" over "Token". Word-boundary matching, stopwords and
 * within-group IDF all scored WORSE than the current code when measured.
 *
 * This measures the alternative before anything is built: attribute by cosine between
 * the query embedding and each member's own vector. Cheap, because the DB still holds
 * one-to-one vectors for every leaf — only the queries need embedding.
 *
 * Reports lexical vs cosine accuracy plus an availability ceiling (how often the
 * correct leaf's vector could be found at all), so a low score can't be mistaken for a
 * method failure when it is really missing data.
 */
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types.ts";
import { buildUnits, pickLeaf, leafScore } from "../../src/server/retrieval/embed-units.ts";
import { contentHash, buildEmbedText } from "../../src/server/retrieval/embed-text.ts";
import { embedQuery, embedBatch } from "../../src/server/retrieval/embed.ts";
import { generateRetrievalQueries } from "../../scripts/eval/eval-retrieval-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const POLICY = (process.argv.find((a) => a.startsWith("--policy="))?.split("=")[1] ??
  "kv_records_breadcrumbs") as Parameters<typeof buildUnits>[1];

function parseVec(s: string): number[] {
  return s.replace(/^\[|\]$/g, "").split(",").map(Number);
}
function cosine(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) d += a[i]! * b[i]!;
  return d; // both sides are L2-normalised by embed.ts
}

const docs = Object.values(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as { nodes: Record<string, AtlasNode> }).nodes,
);
const byId = new Map(docs.map((d) => [d.id, d]));

const units = buildUnits(docs, POLICY, {});
const owner = new Map<string, (typeof units)[number]>();
for (const u of units) if (u.memberIds.length > 1) for (const id of u.memberIds) owner.set(id, u);

const cases = generateRetrievalQueries(docs)
  .filter((q) => ["kv-record", "icd-param", "icd-disambiguation"].includes(q.slice))
  .map((q) => ({ q, target: q.relevant[0]!, unit: owner.get(q.relevant[0]!) }))
  .filter((c) => c.unit);

console.log(`policy=${POLICY} · ${cases.length} queries whose target is folded into a group`);

// Leaf vectors: reuse the DB's one-to-one embeddings, keyed by the same content_hash.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("needs DATABASE_URL (read-only embedding cache)");
const { SQL } = await import("bun");
const sql = new SQL({ url, max: 2 });
const cache = new Map<string, number[]>();
try {
  const rows = (await sql`SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding FROM atlas_doc_embeddings`) as {
    content_hash: string;
    embedding: string;
  }[];
  for (const r of rows) cache.set(r.content_hash, parseVec(r.embedding));
} finally {
  await sql.end();
}
console.log(`  leaf-vector cache: ${cache.size} distinct hashes`);

// Any member without a cached vector gets embedded once (deduped by hash).
const missing = new Map<string, string>();
for (const c of cases) {
  for (const id of c.unit!.memberIds) {
    const n = byId.get(id);
    if (!n) continue;
    const h = contentHash(n);
    if (!cache.has(h)) missing.set(h, buildEmbedText(n));
  }
}
if (missing.size) {
  console.log(`  embedding ${missing.size} member texts absent from the DB…`);
  const entries = [...missing.entries()];
  for (let i = 0; i < entries.length; i += 50) {
    const slice = entries.slice(i, i + 50);
    const vecs = await embedBatch(slice.map(([, t]) => t));
    slice.forEach(([h], j) => cache.set(h, vecs[j]!));
  }
}

// Fuse the two by reciprocal rank, the same way search.ts already fuses its lexical
// and semantic legs (RRF_K = 60). Lexical and cosine fail on DIFFERENT slices —
// lexical wins icd-param 43/15, cosine wins kv-record 61/22 — so a rank fusion should
// beat either alone if the failures really are complementary.
const RRF_K = 60;
// ── Option 2: ONE residual per query, built from the TOP-K RETRIEVED anchors ──
// The per-anchor residual (53%) needs an embed per grouped hit. A single shared
// residual costs one embed per query regardless of hit count — but it must be built
// from what retrieval actually returns, not from the known-correct anchor, and
// stripping the union of several anchor titles risks removing question words too.
// Anchors are ranked here by cosine to the query, which is what the semantic leg
// returns, so the simulation is faithful rather than optimistic.
const anchorPool = units
  .filter((u) => u.memberIds.length > 1)
  .map((u) => ({ id: u.anchorId, node: byId.get(u.anchorId)! }))
  .filter((a) => a.node && cache.has(contentHash(a.node)))
  .map((a) => ({ ...a, vec: cache.get(contentHash(a.node))! }));
console.log(`  anchor pool for the shared-residual simulation: ${anchorPool.length}`);
const K_VALUES = [1, 5, 10, 20, 50];
const sharedRight = new Map<number, number>(K_VALUES.map((k) => [k, 0]));

let lexRight = 0;
let cosRight = 0;
let rrfRight = 0;
let resRight = 0;
let prjRight = 0;
let mpjRight = 0;
let available = 0;
let n = 0;
const bySlice = new Map<string, { n: number; lex: number; cos: number; rrf: number; res: number; prj: number; mpj: number }>();
const flips: string[] = [];

for (const c of cases) {
  const unit = c.unit!;
  const anchor = byId.get(unit.anchorId)!;
  const members = unit.memberIds.map((id) => byId.get(id)).filter((x): x is AtlasNode => !!x);
  const qv = await embedQuery(c.q.query);
  // RESIDUAL query: drop tokens the group ALREADY explains (the anchor's own title).
  // Diagnosed 2026-08-18: a query names its instance ("… Ethereum Mainnet - Fluid
  // sUSDS ERC4626 Vault …") and that long name dominates the embedding, so cosine
  // ranks whichever member echoes the instance name — the anchor itself, or a value
  // that repeats part of it — above the member that answers the question. Inside a
  // group the instance name discriminates nothing; only the rest of the question does.
  const anchorWords = new Set((anchor.title.toLowerCase().match(/[a-z0-9]+/g) ?? []));
  const residual =
    (c.q.query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !anchorWords.has(w)).join(" ") || c.q.query;
  const rv = await embedQuery(residual);

  const lexPick = pickLeaf(c.q.query, members, anchor).node.id;
  let cosPick = anchor.id;
  let best = -Infinity;
  let resPick = anchor.id;
  let resBest = -Infinity;
  // PROJECTION variant: the text-residual needs a second embedding call per grouped
  // hit, which is latency on the query hot path. Removing the instance name from the
  // TEXT is approximately removing the anchor's DIRECTION from the query vector, and
  // that is free arithmetic on vectors we already have.
  const av = cache.get(contentHash(anchor));
  let projQ: number[] | null = null;
  if (av) {
    const d = cosine(qv, av);
    const p = qv.map((x, i) => x - d * av[i]!);
    let nrm = 0;
    for (const x of p) nrm += x * x;
    nrm = Math.sqrt(nrm) || 1;
    projQ = p.map((x) => x / nrm);
  }
  let prjPick = anchor.id;
  let prjBest = -Infinity;
  // MEMBER-PROJECTION: instead of removing the anchor direction from the QUERY at
  // request time (which needs no extra embed but cannot ever select the anchor, hence
  // kv-record 0%), remove it from each MEMBER at index time and store that. Free at
  // query time, and the anchor stays selectable because it is scored on its raw vector.
  let mpjPick = anchor.id;
  let mpjBest = -Infinity;
  for (const m of members) {
    const v = cache.get(contentHash(m));
    if (!v) continue;
    const s = cosine(qv, v);
    if (s > best) {
      best = s;
      cosPick = m.id;
    }
    const r = cosine(rv, v);
    if (r > resBest) {
      resBest = r;
      resPick = m.id;
    }
    if (projQ) {
      const pj = cosine(projQ, v);
      if (pj > prjBest) {
        prjBest = pj;
        prjPick = m.id;
      }
    }
    let mv = v;
    if (av && m.id !== anchor.id) {
      const d2 = cosine(v, av);
      const p2 = v.map((x, i) => x - d2 * av[i]!);
      let nrm2 = 0;
      for (const x of p2) nrm2 += x * x;
      nrm2 = Math.sqrt(nrm2) || 1;
      mv = p2.map((x) => x / nrm2);
    }
    const mp = cosine(qv, mv);
    if (mp > mpjBest) {
      mpjBest = mp;
      mpjPick = m.id;
    }
  }
  // RRF over the two rankings.
  const scored = members.map((m) => {
    const v = cache.get(contentHash(m));
    return { id: m.id, lex: leafScore(c.q.query, m), cos: v ? cosine(qv, v) : -Infinity };
  });
  const rankOf = (key: "lex" | "cos") => {
    const order = [...scored].sort((a, b) => b[key] - a[key]);
    const r = new Map<string, number>();
    order.forEach((x, i) => r.set(x.id, i));
    return r;
  };
  const rl = rankOf("lex");
  const rc = rankOf("cos");
  let rrfPick = anchor.id;
  let rrfBest = -Infinity;
  for (const x of scored) {
    const f = 1 / (RRF_K + (rl.get(x.id) ?? 0) + 1) + 1 / (RRF_K + (rc.get(x.id) ?? 0) + 1);
    if (f > rrfBest) {
      rrfBest = f;
      rrfPick = x.id;
    }
  }
  // Shared residual: strip the union of the top-K retrieved anchor titles, once.
  const ranked = anchorPool
    .map((a) => ({ a, s: cosine(qv, a.vec) }))
    .sort((x, y) => y.s - x.s);
  for (const k of K_VALUES) {
    const strip = new Set<string>();
    for (const { a } of ranked.slice(0, k)) {
      for (const w of a.node.title.toLowerCase().match(/[a-z0-9]+/g) ?? []) strip.add(w);
    }
    const shared =
      (c.q.query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !strip.has(w)).join(" ") || c.q.query;
    const sv = await embedQuery(shared);
    let pick = anchor.id;
    let bestS = -Infinity;
    for (const m of members) {
      const v = cache.get(contentHash(m));
      if (!v) continue;
      const sc = cosine(sv, v);
      if (sc > bestS) {
        bestS = sc;
        pick = m.id;
      }
    }
    if (pick === c.target) sharedRight.set(k, (sharedRight.get(k) ?? 0) + 1);
  }

  const targetVec = cache.get(contentHash(byId.get(c.target)!));

  n++;
  if (targetVec) available++;
  const lexOk = lexPick === c.target;
  const cosOk = cosPick === c.target;
  if (lexOk) lexRight++;
  if (cosOk) cosRight++;
  const rrfOk = rrfPick === c.target;
  if (rrfOk) rrfRight++;
  const resOk = resPick === c.target;
  if (resOk) resRight++;
  const prjOk = prjPick === c.target;
  if (prjOk) prjRight++;
  const mpjOk = mpjPick === c.target;
  if (mpjOk) mpjRight++;
  const b = bySlice.get(c.q.slice) ?? { n: 0, lex: 0, cos: 0, rrf: 0, res: 0, prj: 0, mpj: 0 };
  b.n++;
  if (lexOk) b.lex++;
  if (cosOk) b.cos++;
  if (rrfOk) b.rrf++;
  if (resOk) b.res++;
  if (prjOk) b.prj++;
  if (mpjOk) b.mpj++;
  bySlice.set(c.q.slice, b);
  if (!lexOk && cosOk && flips.length < 6) {
    flips.push(`  "${c.q.query.slice(0, 56)}"\n     lexical: ${byId.get(lexPick)?.title} → cosine: ${byId.get(cosPick)?.title}`);
  }
}

const pct = (x: number) => `${((100 * x) / n).toFixed(0)}%`;
console.log(`\nattribution accuracy over ${n} queries:`);
console.log(`  lexical (current pickLeaf) : ${lexRight}/${n} = ${pct(lexRight)}`);
console.log(`  cosine  (query vs member)  : ${cosRight}/${n} = ${pct(cosRight)}`);
console.log(`  RRF fusion of both         : ${rrfRight}/${n} = ${pct(rrfRight)}`);
console.log(`  cosine on RESIDUAL query   : ${resRight}/${n} = ${pct(resRight)}`);
console.log(`  PROJECTION query-side (free)     : ${prjRight}/${n} = ${pct(prjRight)}`);
console.log(`  PROJECTION member-side (free)    : ${mpjRight}/${n} = ${pct(mpjRight)}`);
for (const k of K_VALUES) {
  const r = sharedRight.get(k) ?? 0;
  console.log(`  SHARED residual, top-${String(k).padEnd(2)} anchors : ${r}/${n} = ${pct(r)}`);
}
console.log(`  ceiling (target vector available at all): ${available}/${n} = ${pct(available)}`);
console.log(`\nby slice:`);
for (const [s, b] of bySlice) {
  console.log(
    `  ${s.padEnd(20)} n=${String(b.n).padStart(3)}  lexical ${((100 * b.lex) / b.n).toFixed(0)}%  cosine ${((100 * b.cos) / b.n).toFixed(0)}%  rrf ${((100 * b.rrf) / b.n).toFixed(0)}%  residual ${((100 * b.res) / b.n).toFixed(0)}%  proj ${((100 * b.prj) / b.n).toFixed(0)}%  memproj ${((100 * b.mpj) / b.n).toFixed(0)}%`,
  );
}
if (flips.length) {
  console.log(`\ncases cosine fixes:`);
  for (const f of flips) console.log(f);
}
