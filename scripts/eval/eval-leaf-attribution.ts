#!/usr/bin/env bun
// Leaf-attribution arm bakeoff — which member of a retrieved GROUP does the
// query actually want?
//
// This is the rig that chose the rule `search.ts` ships (2026-09-30). It was
// written as a throwaway in a session scratchpad, which is the wrong place for
// the only reproduction of a number quoted in CLAUDE.md and in a commit
// message, so it lives here now.
//
// Why it is not an arm inside eval-retrieval.ts: that harness scores RETRIEVAL
// (did the top-k contain the target), sweeping grouping policies and models.
// This scores ATTRIBUTION alone — the group is already retrieved, and the only
// question is which of its members is returned. It therefore needs vectors the
// retrieval harness never asks for, above all an anchor's own one-to-one
// document vector, which production does NOT store (a grouped anchor's row
// holds the UNIT text). That is exactly why `demoteA`, the best-scoring arm
// here, is unshippable today.
//
// Measured over 98 grouped-target queries (2026-09-30):
//
//   lexical                     29.6%   no vectors at all
//   plain query vector          13.3%   worse than lexical — see below
//   lexResid                    39.8%   residual from the lexical leg
//   rrfU0.25                    43.9%   SHIPPED — one round trip
//   rrf(lexResid,demoteA0.5)    44.9%   needs a vector that does not exist
//   shipped (old)               48.0%   residual from the semantic leg, TWO trips
//
// Do not "simplify" attribution to the plain query vector: subtracting a
// per-GROUP constant cannot reorder that group's members, so it collapses ICD
// disambiguation to 2.5%. The per-MEMBER `cos(m, anchor)` penalty is what makes
// a free arm work at all — "prefer the member that answers the question over
// the one that merely echoes the group's name".
//
//   pnpm eval:leaf-attribution                 # uses .cache vectors, embeds misses
//   pnpm eval:leaf-attribution --resamples 10000
//
// DATABASE_URL is read-only and optional: it seeds the vector cache by
// content_hash so a run embeds only what production does not already store.
import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { AtlasNode } from "../../src/types.ts";
import { buildUnits, pickLeaf, unitHash, type EmbedUnit, type GroupPolicy } from "../../src/server/retrieval/embed-units.ts";
import { buildEmbedText, contentHash } from "../../src/server/retrieval/embed-text.ts";
import { residualQuery } from "../../src/server/retrieval/search.ts";
import { embedBatch } from "../../src/server/retrieval/embed.ts";
import { generateRetrievalQueries, type RetrievalQuery } from "./eval-retrieval-queries.ts";
import { MINISEARCH_OPTIONS } from "../../src/lib/searchOptions.ts";
import { expandQueryTokens, partitionByOriginalTerms } from "../../src/lib/searchInflect.ts";
import { config } from "../../src/server/config.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const opt = (n: string) => { const i = argv.indexOf(`--${n}`); return i !== -1 ? argv[i + 1] : undefined; };
const DRY = argv.includes("--dry-run");
const R = Number(opt("resamples") ?? 4000);
const CACHE = path.join(ROOT, ".cache", "eval-leaf-attribution-vectors.json");
const ANCHOR_K = 20; // mirrors search.ts's RESIDUAL_ANCHOR_K

// Two namespaces: `H\0<sha256 of embed text>` (documents and unit texts, which
// hash the same way) and `Q\0<raw query>` (prefixed at embed time, like
// production — a query vector embedded without the instruction prefix is not
// comparable to one embedded with it).
const vecs: Record<string, number[]> = fs.existsSync(CACHE)
  ? (JSON.parse(fs.readFileSync(CACHE, "utf8")) as Record<string, number[]>)
  : {};
const cos = (a: number[], b: number[]) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!; return d; };

const docs = Object.values(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as { nodes: Record<string, AtlasNode> }).nodes,
);
const byId = new Map(docs.map((d) => [d.id, d]));
const units = buildUnits(docs, config.embedGroupPolicy as GroupPolicy, {});
const owner = new Map<string, EmbedUnit>();
for (const u of units) if (u.memberIds.length > 1) for (const id of u.memberIds) owner.set(id, u);

// ---- seed from the DB, then embed whatever is still missing -----------------
async function seedFromDb(): Promise<number> {
  if (!process.env.DATABASE_URL) return 0;
  const { SQL } = await import("bun");
  const sql = new SQL({ url: process.env.DATABASE_URL, max: 2 });
  try {
    const rows = (await sql`SELECT DISTINCT ON (content_hash) content_hash, embedding::text AS embedding
                              FROM atlas_doc_embeddings`) as { content_hash: string; embedding: string }[];
    for (const r of rows) {
      const key = `H\u0000${r.content_hash}`;
      if (!vecs[key]) vecs[key] = r.embedding.replace(/^\[|\]$/g, "").split(",").map(Number);
    }
    return rows.length;
  } finally {
    await sql.end();
  }
}

async function fill(keys: Map<string, string>): Promise<void> {
  const missing = [...keys].filter(([k]) => !vecs[k]);
  if (missing.length === 0) return;
  if (DRY) {
    const chars = missing.reduce((n, [, t]) => n + t.length, 0);
    console.log(`--dry-run: would embed ${missing.length} texts (${chars} chars, ${Math.ceil(missing.length / 50)} batches)`);
    return;
  }
  console.log(`embedding ${missing.length} missing vectors…`);
  for (let i = 0; i < missing.length; i += 50) {
    const slice = missing.slice(i, i + 50);
    const out = await embedBatch(slice.map(([, text]) => text));
    slice.forEach(([k], j) => { vecs[k] = out[j]!; });
    console.log(`  ${Math.min(i + 50, missing.length)}/${missing.length}`);
  }
}

console.log(`seeded ${await seedFromDb()} vectors from DATABASE_URL`);

/** A query whose single target is a FOLDED MEMBER — the only shape attribution
 *  can be scored on. Queries whose target is its own unit have nothing to pick. */
interface GroupedCase { x: RetrievalQuery; target: string; unit: EmbedUnit }
const cases: GroupedCase[] = generateRetrievalQueries(docs)
  .filter((x) => ["kv-record", "icd-param", "icd-disambiguation"].includes(x.slice))
  .flatMap((x) => {
    const target = x.relevant[0]!;
    const unit = owner.get(target);
    return unit ? [{ x, target, unit }] : [];
  });

// Every text this bakeoff needs a vector for, gathered before any embedding so
// the whole run is one batched pass rather than a round trip per query.
const wanted = new Map<string, string>();
for (const u of units) wanted.set(`H\u0000${unitHash(u.text)}`, u.text);
for (const c of cases) {
  wanted.set(`Q\u0000${c.x.query}`, config.embedQueryPrefix + c.x.query);
  const anchor = byId.get(c.unit.anchorId);
  if (anchor) wanted.set(`H\u0000${contentHash(anchor)}`, buildEmbedText(anchor));
  for (const id of c.unit.memberIds) {
    const m = byId.get(id);
    if (m) wanted.set(`H\u0000${contentHash(m)}`, buildEmbedText(m));
  }
}
await fill(wanted);
if (DRY) {
  console.log(`--dry-run: ${cases.length} grouped-target cases, ${units.length} units, policy ${config.embedGroupPolicy}`);
  process.exit(0);
}

const U = (u: { text: string }) => vecs[`H\u0000${unitHash(u.text)}`];
const D = (n: AtlasNode) => vecs[`H\u0000${contentHash(n)}`];
const Q = (t: string) => vecs[`Q\u0000${t}`];

// The two residual queries depend on rankings, so they can only be embedded
// once those are known — a second batched pass.
const pool = units.map((u) => ({ u, title: byId.get(u.anchorId)?.title ?? "", vec: U(u) })).filter((a) => a.vec);
const mini = MiniSearch.loadJSON(fs.readFileSync(path.join(ROOT, "public/search-index.json"), "utf8"), MINISEARCH_OPTIONS);

function lexicalTitles(query: string): string[] {
  const ex = expandQueryTokens(query.trim().split(/\s+/).filter(Boolean));
  let res = mini.search(ex.extra.length ? `${query} ${ex.extra.join(" ")}` : query, {
    boost: { title: 10, doc_no: 5, type: 2 }, prefix: true, fuzzy: false, combineWith: "OR",
  });
  if (ex.extra.length) res = partitionByOriginalTerms(res as never, new Set(ex.originals)) as never;
  return res.slice(0, ANCHOR_K).map((r) => byId.get(r.id as string)?.title).filter((t): t is string => !!t);
}

const residuals = new Map<string, { sem: string; lex: string }>();
const wanted2 = new Map<string, string>();
for (const c of cases) {
  const qv = Q(c.x.query)!;
  const semTitles = pool
    .map((a) => ({ a, s: cos(qv, a.vec!) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, ANCHOR_K)
    .map((x) => x.a.title)
    .filter(Boolean);
  const sem = residualQuery(c.x.query, semTitles);
  const lex = residualQuery(c.x.query, lexicalTitles(c.x.query));
  residuals.set(c.x.id, { sem, lex });
  wanted2.set(`Q\u0000${sem}`, config.embedQueryPrefix + sem);
  wanted2.set(`Q\u0000${lex}`, config.embedQueryPrefix + lex);
}
await fill(wanted2);
fs.mkdirSync(path.dirname(CACHE), { recursive: true });
fs.writeFileSync(CACHE, JSON.stringify(vecs));
console.log(`cache: ${Object.keys(vecs).length} vectors → ${path.relative(ROOT, CACHE)}`);

// ---- arms ------------------------------------------------------------------
const LAMBDAS = [0.25, 0.5, 0.75];
const ARMS = ["lexical", "semResid", "lexResid", ...LAMBDAS.map((l) => `demoteU${l}`),
  ...LAMBDAS.map((l) => `rrfU${l}`), "rrf(lexResid,demoteA0.5)"];
const hit: Record<string, number> = Object.fromEntries(ARMS.map((a) => [a, 0]));
const bySlice = new Map<string, Record<string, number>>();
const trace: Record<string, number>[] = [];
const RRF_K = 60; // same constant as the shared rrfFuse

for (const c of cases) {
  const anchor = byId.get(c.unit.anchorId)!;
  const members = c.unit.memberIds.map((id) => byId.get(id)).filter((m): m is AtlasNode => !!m);
  const qv = Q(c.x.query)!;
  const res = residuals.get(c.x.id)!;
  const rv = Q(res.sem);
  const lv = Q(res.lex);
  const unitVec = U(c.unit)!;
  const anchorDocVec = D(anchor);
  const rows = members.map((m) => ({ id: m.id, v: D(m) })).filter((r): r is { id: string; v: number[] } => !!r.v);

  const best = (f: (r: { id: string; v: number[] }) => number) =>
    rows.length ? rows.reduce((b, r) => (f(r) > f(b) ? r : b)).id : anchor.id;
  const rank = (f: (r: { id: string; v: number[] }) => number) => {
    const m = new Map<string, number>();
    [...rows].sort((a, b) => f(b) - f(a)).forEach((r, i) => m.set(r.id, i));
    return m;
  };
  const fuse = (f1: (r: { id: string; v: number[] }) => number, f2: (r: { id: string; v: number[] }) => number) => {
    const r1 = rank(f1), r2 = rank(f2);
    const s = (id: string) => 1 / (RRF_K + r1.get(id)! + 1) + 1 / (RRF_K + r2.get(id)! + 1);
    return rows.reduce((b, r) => (s(r.id) > s(b.id) ? r : b)).id;
  };

  const picks: Record<string, string> = {
    lexical: pickLeaf(c.x.query, members, anchor).node.id,
    semResid: rv ? best((r) => cos(rv, r.v)) : "",
    lexResid: lv ? best((r) => cos(lv, r.v)) : "",
  };
  for (const l of LAMBDAS) {
    picks[`demoteU${l}`] = best((r) => cos(qv, r.v) - l * cos(r.v, unitVec));
    picks[`rrfU${l}`] = lv && rows.length
      ? fuse((r) => cos(lv, r.v), (r) => cos(qv, r.v) - l * cos(r.v, unitVec))
      : "";
  }
  picks["rrf(lexResid,demoteA0.5)"] = lv && anchorDocVec && rows.length
    ? fuse((r) => cos(lv, r.v), (r) => cos(qv, r.v) - 0.5 * cos(r.v, anchorDocVec!))
    : "";

  trace.push(Object.fromEntries(ARMS.map((a) => [a, picks[a] === c.target ? 1 : 0])));
  const b = bySlice.get(c.x.slice) ?? Object.fromEntries([["n", 0], ...ARMS.map((a) => [a, 0])]);
  b.n!++;
  for (const a of ARMS) if (picks[a] === c.target) { hit[a]!++; b[a]!++; }
  bySlice.set(c.x.slice, b);
}

const n = trace.length;
const pct = (x: number, d = n) => `${((100 * x) / d).toFixed(1)}%`;
console.log(`\nleaf attribution over ${n} grouped-target queries (policy ${config.embedGroupPolicy})\n`);
for (const a of ARMS) console.log(`  ${a.padEnd(26)} ${String(hit[a]).padStart(3)}/${n} = ${pct(hit[a]!)}`);
console.log("\nby slice:");
for (const [s, b] of bySlice) {
  console.log(`  ${s.padEnd(20)} n=${String(b.n).padStart(3)}  ` +
    ARMS.map((a) => `${a} ${pct(b[a]!, b.n!)}`).join("  "));
}

// Paired bootstrap: resample the SAME queries for every arm, so the comparison
// is within-query. A 4-point gap on 98 queries is worth nothing if the
// resampling distribution straddles zero — which is exactly what it does for
// the shipped arm against the old two-round-trip rule.
function boot(a: string, b: string): string {
  const diffs: number[] = [];
  let wins = 0;
  for (let r = 0; r < R; r++) {
    let d = 0;
    for (let i = 0; i < n; i++) { const t = trace[(Math.random() * n) | 0]!; d += t[a]! - t[b]!; }
    diffs.push((100 * d) / n);
    if (d > 0) wins++;
  }
  diffs.sort((x, y) => x - y);
  const point = (100 * trace.reduce((s, t) => s + t[a]! - t[b]!, 0)) / n;
  return `${a} − ${b}: ${point.toFixed(1)} pts  95% CI ` +
    `[${diffs[Math.floor(R * 0.025)]!.toFixed(1)}, ${diffs[Math.floor(R * 0.975)]!.toFixed(1)}]  ` +
    `P(${a} better)=${(wins / R).toFixed(2)}`;
}
console.log(`\npaired bootstrap (${R} resamples of the same ${n} queries):`);
for (const pair of [["lexResid", "semResid"], ["rrfU0.25", "semResid"], ["rrfU0.25", "lexResid"],
  ["lexResid", "lexical"], ["rrfU0.25", "lexical"]] as const) {
  console.log(`  ${boot(pair[0], pair[1])}`);
}
