// Census-routing bakeoff: should the concept-census skill (concepts-prefetch.ts)
// route a question to its up-to-3 slugs by regex signature (today) or by
// embedding similarity (routeCensuses, skills/similarity.ts's
// rankPrototypeSets)? Writes .cache/eval-census.json.
//
//   pnpm eval:census
//
// Sibling script rather than a --census arm on eval-skills.ts: that file
// scores a single skill's binary fire/miss; this is 1-of-10 ROUTING (which
// slug, if any) with its own scorer (set-membership recall, not a boolean)
// and its own corpus shape (every positive case carries an expected slug).
// Folding the two loops into one file would blow past both files' ~150-line
// convention for zero shared code beyond what's already factored into
// similarity.ts and eval-skills-queries.ts.
//
// DECISION RULE: census payloads are tiny (373B for one census, 1657B for
// three — measured, vs ~8KB for the features guide the skills bakeoff
// protects). Over-firing here is 5-20x cheaper than there, so the
// recall-favoring policy (CLAUDE.md's chat-skills section) applies even
// harder: adopt similarity if it recovers regex-missed routes at a
// false-fire rate that stays low relative to that cheap payload — it does
// not need to hit zero the way the features lane's decision rule demanded.
//
// Every arm here calls PRODUCTION functions (matchConceptCensuses,
// routeCensuses, rankPrototypeSets) — never a reimplementation — so this
// measures the rule the server actually runs, including at the shipped
// margin (config.chatCensusSimilarityMargin), not a parallel guess at it.
import fs from "node:fs";
import path from "node:path";
import { matchConceptCensuses, routeCensuses, CENSUS_PROTOTYPES, CENSUS_NEGATIVE_PROTOTYPES } from "../../src/server/concepts-prefetch.ts";
import { rankPrototypeSets, isSmallTalk } from "../../src/server/skills/similarity.ts";
import { CENSUS_TRIGGER_CASES, censusNegatives, type CensusCase } from "./eval-census-queries.ts";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";
import type { CensusSlug } from "../../src/lib/conceptsCensus.ts";

const MAX_CENSUSES = 3;
// Same recall-favoring weighting as eval-skills.ts, for the same reason: a
// miss loses an answer, a false fire wastes a few hundred bytes the model can
// ignore. BETA is even more defensible here given the smaller payload.
const BETA = 3;

interface Scored extends CensusCase {
  regexSlugs: CensusSlug[];
  smalltalk: boolean;
  ranked: { slug: string; score: number; margin: number }[]; // sorted desc by margin
}

interface ArmResult {
  arm: string;
  threshold: number | null;
  tp: number; fp: number; fn: number; tn: number;
  f1: number; fbeta: number;
  falseFires: string[];
  misses: string[];
}

function score(firedFn: (c: Scored) => CensusSlug[], cases: Scored[], arm: string, threshold: number | null): ArmResult {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const falseFires: string[] = [];
  const misses: string[] = [];
  for (const c of cases) {
    const fired = firedFn(c);
    if (c.expectSlug === null) {
      if (fired.length > 0) (fp++, falseFires.push(`${c.q} -> ${fired.join(",")}`));
      else tn++;
    } else if (fired.includes(c.expectSlug)) {
      tp++;
    } else {
      fn++;
      misses.push(`${c.q} [want ${c.expectSlug}, got ${fired.join(",") || "-"}]`);
    }
  }
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  const beta2 = BETA * BETA;
  const fbeta = tp === 0 ? 0 : ((1 + beta2) * tp) / ((1 + beta2) * tp + beta2 * fn + fp);
  return { arm, threshold, tp, fp, fn, tn, f1, fbeta, falseFires, misses };
}

function line(r: ArmResult): string {
  const t = r.threshold === null ? "    —" : r.threshold.toFixed(3).padStart(6);
  const recall = r.tp + r.fn === 0 ? 0 : r.tp / (r.tp + r.fn);
  const fpRate = r.fp + r.tn === 0 ? 0 : r.fp / (r.fp + r.tn);
  return (
    `  ${r.arm.padEnd(26)} thr=${t}  tp=${String(r.tp).padStart(2)} fp=${String(r.fp).padStart(2)} fn=${String(r.fn).padStart(2)} tn=${String(r.tn).padStart(3)}` +
    `  routing-acc=${(recall * 100).toFixed(0).padStart(3)}%  false-fire=${(fpRate * 100).toFixed(1).padStart(4)}%  F${BETA}=${r.fbeta.toFixed(3)}`
  );
}

function bestPoint(arms: ArmResult[]): ArmResult {
  return arms.slice().sort((a, b) => b.fbeta - a.fbeta)[0]!;
}

async function main() {
  const ix = loadIndexes();
  const subjects = [...new Set([...ix.entities.map((e) => e.name), ...[...ix.docMap.values()].map((d) => d.title)])]
    .filter((t) => t.length > 3 && t.length < 60)
    .sort();
  const all: CensusCase[] = [...CENSUS_TRIGGER_CASES, ...censusNegatives(subjects)];

  const cases: Scored[] = all.map((c) => ({
    ...c,
    regexSlugs: matchConceptCensuses(c.q),
    smalltalk: isSmallTalk(c.q),
    ranked: rankPrototypeSets(c.q, CENSUS_PROTOTYPES, CENSUS_NEGATIVE_PROTOTYPES),
  }));

  // Interleaved split within each label so both halves see the same mix of
  // positive slugs and negative sources — see eval-skills.ts's identical note.
  const half = (want: boolean, parity: number) => cases.filter((c) => (c.expectSlug !== null) === want).filter((_, i) => i % 2 === parity);
  const train = [...half(true, 0), ...half(false, 0)];
  const test = [...half(true, 1), ...half(false, 1)];

  const regexArm = score((c) => c.regexSlugs, cases, "regex (today)", null);
  const regexTest = score((c) => c.regexSlugs, test, "regex (test half)", null);

  // routeCensuses IS the production function; a hard-coded arithmetic
  // reimplementation here would risk exactly the drift skills/similarity.ts
  // warns about ("an eval that scores a different rule measures nothing").
  const hybrid = (c: Scored, thr: number) => routeCensuses(c.q, thr);

  const sweep: ArmResult[] = [];
  const trainSweep: ArmResult[] = [];
  for (let m = -0.2; m <= 0.35; m += 0.025) {
    const thr = Number(m.toFixed(3));
    sweep.push(score((c) => hybrid(c, thr), cases, "regex OR similarity", thr));
  }
  for (let m = -0.25; m <= 0.4; m += 0.005) {
    const thr = Number(m.toFixed(3));
    trainSweep.push(score((c) => hybrid(c, thr), train, "regex OR similarity (train)", thr));
  }
  const trainPicked = bestPoint(trainSweep).threshold!;
  const trainPickedTest = score((c) => hybrid(c, trainPicked), test, "regex OR similarity (TEST)", trainPicked);
  const shipped = config.chatCensusSimilarityMargin;
  const shippedTest = score((c) => hybrid(c, shipped), test, "regex OR similarity (TEST)", shipped);
  const shippedAll = score((c) => hybrid(c, shipped), cases, "regex OR similarity (all)", shipped);

  console.log(`${cases.length} labeled questions (${cases.filter((c) => c.expectSlug !== null).length} should route somewhere)\n`);
  console.log(line(regexArm));
  console.log(line(regexTest));
  console.log("\nfull-corpus sweep:");
  for (const a of sweep) console.log(line(a) + (a.threshold === shipped ? "   <- SHIPPED (config.chatCensusSimilarityMargin)" : a.threshold === trainPicked ? "   <- train-fitted pick" : ""));
  console.log(`\ntrain-fitted pick (${trainPicked}), held out:`);
  console.log(line(trainPickedTest));
  console.log(`\nSHIPPED margin (${shipped}), held out and on the whole corpus — the headline numbers:`);
  console.log(line(shippedTest) + "   <- HELD-OUT");
  console.log(line(shippedAll));

  console.log(`\nregex misses (what similarity would have to recover), ${regexArm.misses.length} of ${cases.filter((c) => c.expectSlug !== null).length}:`);
  for (const m of regexArm.misses) console.log(`  · ${m}`);

  console.log(`\nshipped (all, thr=${shipped}) false fires (${shippedAll.fp}):`);
  for (const f of shippedAll.falseFires) console.log(`  · ${f}`);
  console.log(`shipped (all, thr=${shipped}) remaining misses (${shippedAll.misses.length}):`);
  for (const m of shippedAll.misses) console.log(`  · ${m}`);

  // Real traffic, not my corpus — the only honest false-fire check on
  // messages nobody wrote for this test (same rationale as eval-skills.ts's
  // identical block, which this mirrors).
  if (process.env.DATABASE_URL) {
    const { sql } = await import("../../src/server/db.ts");
    const rows = (await sql`SELECT content FROM messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 500`) as { content: string }[];
    const newFires = rows
      .map((r) => r.content.slice(0, 300))
      .filter((q) => matchConceptCensuses(q).length === 0)
      .map((q) => ({ q, slugs: routeCensuses(q) }))
      .filter((r) => r.slugs.length > 0);
    console.log(`\nreal messages from DATABASE_URL: ${rows.length}`);
    console.log(`  regex fires on ${rows.filter((r) => matchConceptCensuses(r.content.slice(0, 300)).length > 0).length}; similarity adds ${newFires.length} more`);
    for (const r of newFires.slice(0, 12)) console.log(`  + [${r.slugs.join(",")}]  ${r.q.slice(0, 90).replace(/\s+/g, " ")}`);
  }

  const out = path.join(".cache", "eval-census.json");
  fs.mkdirSync(".cache", { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), regexArm, regexTest, sweep, trainPicked, trainPickedTest, shipped, shippedTest, shippedAll, cases }, null, 2),
  );
  console.log(`\nwrote ${out}`);
}

await main();
