// Tier-router similarity-lane bakeoff (sibling to eval-facts.ts / eval-census.ts):
// should a whole-corpus question reach the STRONG tier by regex alone, or also
// by embedding similarity (ternlight — on-device, 384-dim, no network)?
// Writes .cache/eval-complexity.json.
//
// DECISION RULE, and it differs from both siblings. A false fire routes an easy
// question to the strong tier, which the 2026-08-21 bakeoff measured as BETTER
// and FASTER than the default (0.942 vs 0.781, 26.6s vs 43.4s) — so over-firing
// costs tokens and nothing else, while under-firing leaves a whole-corpus
// question with the model scored at 0.70 completeness on that exact class. The
// features lane demanded zero false fires because a false fire there injected
// 8KB of wrong context; that bar does not apply here. Recall is what to
// maximize, at a false-fire rate that stays defensible on real traffic.
import fs from "node:fs";
import path from "node:path";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { routeTier } from "../../src/server/chat/model-router.ts";
import { looksComplex } from "../../src/server/chat/complexity.ts";
import { config } from "../../src/server/config.ts";
import { COMPLEXITY_CASES, type ComplexityCase } from "./eval-complexity-queries.ts";
import { atlasNegatives } from "./eval-facts-queries.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const REPORT_PATH = path.join(ROOT, ".cache", "eval-complexity.json");

// Recall is worth BETA times precision: a miss leaves the question with the
// weaker model on the class it is weakest at; a false fire spends tokens on a
// model that answers better and faster anyway.
const BETA = 3;

interface Arm { thr: number; tp: number; fp: number; fn: number; tn: number; f1: number; fbeta: number }

function score(cases: { fire: boolean; hit: boolean }[], thr: number): Arm {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const c of cases) {
    if (c.fire && c.hit) tp++;
    else if (!c.fire && c.hit) fp++;
    else if (c.fire && !c.hit) fn++;
    else tn++;
  }
  const prec = tp + fp === 0 ? 0 : tp / (tp + fp);
  const rec = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f = (b: number) => (prec + rec === 0 ? 0 : (1 + b * b) * ((prec * rec) / (b * b * prec + rec)));
  return { thr, tp, fp, fn, tn, f1: f(1), fbeta: f(BETA) };
}

const ix = loadIndexes();
const subjects = [...new Set([...ix.entities.map((e) => e.name), ...[...ix.docMap.values()].map((d) => d.title)])]
  .filter((t) => t.length > 3 && t.length < 60)
  .sort();
// Generated single-subject lookups from REAL atlas titles — the same negative
// population eval-facts.ts measures against, so the two lanes are comparable.
const generated: ComplexityCase[] = atlasNegatives(subjects).map((c) => ({ q: c.q, fire: false, note: "generated from atlas" }));
const all = [...COMPLEXITY_CASES, ...generated];

// looksComplex IS the production function; a reimplementation of the margin
// arithmetic here would risk exactly the drift facts/similarity.ts warns about
// ("an eval that scores a different rule measures nothing").
// routeTier now CALLS looksComplex, so asking it for a "regex only" baseline
// would silently include the lane under test at the shipped margin — a
// circular arm that reports the regexes catching what the embedding caught.
// Disable the shared kill switch to get the deterministic signals alone.
const withSimilarityOff = <T>(fn: () => T): T => {
  const prev = config.chatFactSimilarity;
  (config as { chatFactSimilarity: boolean }).chatFactSimilarity = false;
  try { return fn(); } finally { (config as { chatFactSimilarity: boolean }).chatFactSimilarity = prev; }
};
const scored = all.map((c) => ({ ...c, regex: withSimilarityOff(() => routeTier(c.q).tier === "strong") }));

console.log(`corpus: ${all.length} (${all.filter((c) => c.fire).length} positive / ${all.filter((c) => !c.fire).length} negative, ${generated.length} generated)\n`);

const regexArm = score(scored.map((c) => ({ fire: c.fire, hit: c.regex })), NaN);
console.log(`regex alone (today):        tp=${regexArm.tp} fp=${regexArm.fp} fn=${regexArm.fn} recall=${((regexArm.tp / (regexArm.tp + regexArm.fn)) * 100).toFixed(0)}%`);

const arms: Arm[] = [];
console.log("\nthr    tp  fp  fn   tn   recall  false-fire  F3");
for (let m = 0.0; m <= 0.5001; m += 0.025) {
  const a = score(scored.map((c) => ({ fire: c.fire, hit: c.regex || looksComplex(c.q, m) })), m);
  arms.push(a);
  const rec = (a.tp / (a.tp + a.fn)) * 100, ff = (a.fp / (a.fp + a.tn)) * 100;
  const mark = Math.abs(m - config.chatComplexitySimilarityMargin) < 0.0125 ? "  <- SHIPPED" : "";
  console.log(`${m.toFixed(3)}  ${String(a.tp).padStart(2)}  ${String(a.fp).padStart(2)}  ${String(a.fn).padStart(2)}  ${String(a.tn).padStart(3)}   ${rec.toFixed(0).padStart(3)}%     ${ff.toFixed(1).padStart(4)}%     ${a.fbeta.toFixed(3)}${mark}`);
}

const best = arms.slice().sort((a, b) => b.fbeta - a.fbeta)[0]!;
console.log(`\nbest F3 at thr=${best.thr.toFixed(3)} (shipped: ${config.chatComplexitySimilarityMargin})`);

console.log("\n--- positives still missed at the shipped margin ---");
for (const c of scored.filter((c) => c.fire && !c.regex && !looksComplex(c.q))) console.log(`  ${c.q}`);
console.log("\n--- false fires at the shipped margin ---");
const shippedFf = scored.filter((c) => !c.fire && (c.regex || looksComplex(c.q)));
for (const c of shippedFf) console.log(`  [${c.note ?? "hard"}] ${c.q.slice(0, 70)}`);
if (!shippedFf.length) console.log("  (none)");

// Real traffic, not my corpus. The labeled set is small and hand-written, and
// the threshold is fitted on the same questions it is scored on — so the only
// honest check on false fires is messages nobody wrote for this test. This is
// what set chatCensusSimilarityMargin; see config.ts.
let realFires: string[] = [];
if (process.env.DATABASE_URL) {
  // Fail-soft: an unreachable DB must not lose the corpus results already
  // printed above. The check is the most valuable arm here, so say loudly when
  // it did not run rather than exiting non-zero.
  try {
    const { sql } = await import("../../src/server/db.ts");
    const rows = (await sql`SELECT content FROM messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 500`) as { content: string }[];
    const seen = [...new Set(rows.map((r) => r.content.slice(0, 300)))];
    const regexFires = seen.filter((q) => withSimilarityOff(() => routeTier(q).tier === "strong"));
    realFires = seen.filter((q) => !withSimilarityOff(() => routeTier(q).tier === "strong") && looksComplex(q));
    console.log(`\nreal messages from DATABASE_URL: ${seen.length}`);
    console.log(`  regex already routes strong: ${regexFires.length} (${((regexFires.length / seen.length) * 100).toFixed(0)}%)`);
    console.log(`  similarity ADDS:             ${realFires.length} (${((realFires.length / seen.length) * 100).toFixed(0)}%)`);
    for (const q of realFires.slice(0, 25)) console.log(`    + ${q.slice(0, 76).replace(/\n/g, " ")}`);
    await sql.end();
  } catch (err) {
    console.log(`\n!! real-traffic check FAILED (${(err as Error).message}) — corpus numbers above stand, but the`);
    console.log("!! check that set the census margin did NOT run. Bring the DB up before trusting a lower margin.");
  }
} else {
  console.log("\n(no DATABASE_URL — skipped the real-traffic false-fire check, the one that set the census margin)");
}

fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
fs.writeFileSync(REPORT_PATH, JSON.stringify({ ranAt: new Date().toISOString(), shipped: config.chatComplexitySimilarityMargin, regexArm, arms, realFires }, null, 1));
console.log(`\nwrote ${REPORT_PATH}`);
