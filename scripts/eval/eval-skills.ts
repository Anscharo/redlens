// Skill-trigger bakeoff: should the app-documentation skill fire deterministically
// (regex signatures, today) or by embedding similarity (ternlight — on-device,
// 384-dim, ~5ms/embed, no network)? Writes .cache/eval-skills.json.
//
//   pnpm eval:skills            regex baseline only (no dependency needed)
//   pnpm eval:skills --embed    adds the similarity arms (needs @ternlight/base)
//
// DECISION RULE, stated before the numbers: a false fire injects ~8KB of product
// documentation into an atlas question and steers the answer; a miss only costs
// a less-specific answer. So similarity is worth adopting ONLY if it recovers
// regex-missed positives at ZERO new false fires — the same standard the census
// lane holds ("never fires on ordinary doc-lookup phrasing").
//
// Scope note: only the FEATURES lane is classifier-shaped. The glossary and
// entity lanes match to find out WHICH term or entity to inject — the match IS
// the extraction, so "similarity instead of matching" does not apply to them.
import fs from "node:fs";
import path from "node:path";
import { matchesFeaturesQuestion, FEATURES_PROTOTYPES } from "../../src/server/skills/features.ts";
import { ATLAS_PROTOTYPES, isSmallTalk, namesAtlasSubject } from "../../src/server/skills/similarity.ts";
import { TRIGGER_CASES, atlasNegatives, type TriggerCase } from "./eval-skills-queries.ts";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { config } from "../../src/server/config.ts";

interface Scored extends TriggerCase {
  regex: boolean;
  atlasSubject: boolean; // question names a real glossary term / entity / doc title
  smalltalk: boolean;
  posSim?: number; // best similarity to a features prototype
  negSim?: number; // best similarity to an atlas prototype
}

// The suppressors and the small-talk list are imported from production
// (skills/similarity.ts), not redefined here — an eval that scores a different
// rule than the server runs measures nothing.

// Recall is worth BETA times precision here: over-injecting wastes ~2k tokens
// the answering model can discard; under-injecting can lose the answer outright.
const BETA = 3;
const WASTED_TOKENS_PER_FIRE = 2000;

interface ArmResult {
  arm: string;
  threshold: number | null;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  f1: number;
  fbeta: number;
  falseFires: string[];
  misses: string[];
}

function score(fired: (c: Scored) => boolean, cases: Scored[], arm: string, threshold: number | null): ArmResult {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const falseFires: string[] = [];
  const misses: string[] = [];
  for (const c of cases) {
    const f = fired(c);
    if (f && c.fire) tp++;
    else if (f && !c.fire) (fp++, falseFires.push(c.q));
    else if (!f && c.fire) (fn++, misses.push(c.q));
    else tn++;
  }
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  // Injected context is judged by the answering model, which can ignore a block
  // it doesn't need. So a miss (context that would have answered the question
  // never arrives) costs far more than a false fire (a few thousand wasted
  // tokens). BETA weights recall that many times precision — the selection
  // metric, where F1 would pretend the two errors are equal.
  const beta2 = BETA * BETA;
  const fbeta = tp === 0 ? 0 : ((1 + beta2) * tp) / ((1 + beta2) * tp + beta2 * fn + fp);
  return { arm, threshold, tp, fp, fn, tn, f1, fbeta, falseFires, misses };
}

function line(r: ArmResult): string {
  const t = r.threshold === null ? "    —" : r.threshold.toFixed(2).padStart(5);
  const recall = r.tp + r.fn === 0 ? 0 : r.tp / (r.tp + r.fn);
  const fpRate = r.fp + r.tn === 0 ? 0 : r.fp / (r.fp + r.tn);
  return (
    `  ${r.arm.padEnd(24)} thr=${t}  tp=${String(r.tp).padStart(2)} fp=${String(r.fp).padStart(2)} fn=${String(r.fn).padStart(2)} tn=${String(r.tn).padStart(3)}` +
    `  recall=${(recall * 100).toFixed(0).padStart(3)}%  false-fire=${(fpRate * 100).toFixed(1).padStart(4)}%  F${BETA}=${r.fbeta.toFixed(3)}`
  );
}

// Best operating point under the decision rule: most positives recovered with
// zero false fires. Falls back to best F1 when nothing achieves zero FP.
function bestPoint(arms: ArmResult[]): { zeroFp: ArmResult | null; bestF1: ArmResult } {
  const zero = arms.filter((a) => a.fp === 0).sort((a, b) => b.tp - a.tp)[0] ?? null;
  const best = arms.slice().sort((a, b) => b.fbeta - a.fbeta)[0]!;
  return { zeroFp: zero, bestF1: best };
}

async function main() {
  const withEmbed = process.argv.includes("--embed");

  // Hand-written cases + governance questions generated from real atlas titles
  // and entity names in product-question shapes ("what can <real entity> do?").
  const ix = loadIndexes();
  const subjects = [
    ...new Set([...ix.entities.map((e) => e.name), ...[...ix.docMap.values()].map((d) => d.title)]),
  ]
    .filter((t) => t.length > 3 && t.length < 60)
    .sort(); // deterministic order before striding
  const all: TriggerCase[] = [...TRIGGER_CASES, ...atlasNegatives(subjects)];
  const cases: Scored[] = all.map((c) => ({
    ...c,
    regex: matchesFeaturesQuestion(c.q),
    atlasSubject: namesAtlasSubject(ix, c.q),
    smalltalk: isSmallTalk(c.q),
  }));

  // Fit the threshold on half, report it on the other half. Interleaved split
  // (every other case within each label) so both halves carry the same mix of
  // families rather than whatever the file order happens to group.
  const half = (want: boolean, parity: number) => cases.filter((c) => c.fire === want).filter((_, i) => i % 2 === parity);
  const train = [...half(true, 0), ...half(false, 0)];
  const test = [...half(true, 1), ...half(false, 1)];

  const arms: ArmResult[] = [];
  const regexArm = score((c) => c.regex, cases, "regex (today)", null);
  arms.push(regexArm);

  let embedMs = 0;
  if (withEmbed) {
    const { embed, cosineSim } = (await import("@ternlight/base")) as {
      embed: (t: string) => Float32Array;
      cosineSim: (a: Float32Array, b: Float32Array) => number;
    };
    const t0 = performance.now();
    const pos = FEATURES_PROTOTYPES.map(embed);
    const neg = ATLAS_PROTOTYPES.map(embed);
    const protoMs = performance.now() - t0;

    const t1 = performance.now();
    for (const c of cases) {
      const v = embed(c.q);
      c.posSim = Math.max(...pos.map((p) => cosineSim(v, p)));
      c.negSim = Math.max(...neg.map((p) => cosineSim(v, p)));
    }
    embedMs = (performance.now() - t1) / cases.length;
    console.log(`ternlight: ${FEATURES_PROTOTYPES.length + ATLAS_PROTOTYPES.length} prototypes in ${protoMs.toFixed(0)}ms (once, at startup) · ${embedMs.toFixed(1)}ms per query\n`);

    for (let t = 0.3; t <= 0.85; t += 0.05) {
      const thr = Number(t.toFixed(2));
      arms.push(score((c) => (c.posSim ?? 0) >= thr, cases, "absolute similarity", thr));
    }
    for (let m = -0.05; m <= 0.3; m += 0.025) {
      const thr = Number(m.toFixed(3));
      arms.push(score((c) => (c.posSim ?? 0) - (c.negSim ?? 0) >= thr, cases, "margin over atlas", thr));
    }
    // What the deterministic lane and a similarity net do together — the arm
    // actually under consideration. Threshold chosen on TRAIN only.
    // Two candidate hybrids: similarity alone, and similarity with the
    // deterministic suppressors (names a real atlas subject / is small talk).
    const margin = (c: Scored) => (c.posSim ?? 0) - (c.negSim ?? 0);
    const lanes: [string, (c: Scored, thr: number) => boolean][] = [
      ["regex OR margin", (c, thr) => c.regex || margin(c) >= thr],
      ["regex OR gated margin", (c, thr) => c.regex || (!c.atlasSubject && !c.smalltalk && margin(c) >= thr)],
    ];
    for (const [name, fires] of lanes) {
      // The whole curve, so the recall/false-fire trade is visible rather than
      // hidden behind one chosen number.
      for (let m = -0.2; m <= 0.35; m += 0.025) {
        const thr = Number(m.toFixed(3));
        arms.push(score((c) => fires(c, thr), cases, `${name} (sweep)`, thr));
      }
      const trainArms = [];
      for (let m = -0.25; m <= 0.4; m += 0.005) {
        const thr = Number(m.toFixed(3));
        trainArms.push(score((c) => fires(c, thr), train, `${name} (train)`, thr));
      }
      // Headline the SHIPPED setting, not a freshly-fitted one — this is a
      // regression test of what the server actually runs, with the train-fitted
      // pick reported beside it as advice.
      const thr = config.chatSkillSimilarityMargin;
      arms.push(bestPoint(trainArms).bestF1);
      arms.push(score((c) => fires(c, thr), test, `${name} (TEST)`, thr));
      arms.push(score((c) => fires(c, thr), cases, `${name} (all)`, thr));
    }
    arms.push(score((c) => c.regex, test, "regex (test half)", null));
  }

  console.log(`${cases.length} labeled questions (${cases.filter((c) => c.fire).length} should fire)\n`);
  console.log(line(regexArm));
  const kinds = ["regex (test half)", "regex OR gated margin (sweep)"];
  for (const n of ["regex OR margin", "regex OR gated margin"]) for (const p of ["(train)", "(TEST)", "(all)"]) kinds.push(`${n} ${p}`);
  for (const kind of kinds) {
    const of = arms.filter((a) => a.arm === kind);
    if (!of.length) continue;
    console.log();
    const { zeroFp, bestF1 } = bestPoint(of);
    for (const a of of) console.log(line(a) + (a === zeroFp ? "   ← best zero-false-fire" : a === bestF1 ? "   ← best F1" : ""));
  }

  if (withEmbed) {
    console.log("\nthe boundary: worst 12 positives and best 12 negatives, by margin");
    const byMargin = cases.slice().sort((a, b) => (b.posSim! - b.negSim!) - (a.posSim! - a.negSim!));
    const boundary = [...byMargin.filter((c) => c.fire).slice(-12), ...byMargin.filter((c) => !c.fire).slice(0, 12)];
    for (const c of boundary.sort((a, b) => (b.posSim! - b.negSim!) - (a.posSim! - a.negSim!))) {
      const margin = c.posSim! - c.negSim!;
      const mark = c.fire ? "＋" : "－";
      const rx = c.regex ? "regex✓" : "regex✗";
      console.log(`  ${mark} ${margin >= 0 ? " " : ""}${margin.toFixed(3)}  pos=${c.posSim!.toFixed(3)} neg=${c.negSim!.toFixed(3)}  ${rx}  ${c.q}${c.note ? `  — ${c.note}` : ""}`);
    }
  }

  // Real traffic, not my corpus. The labeled set is small and hand-written, and
  // the threshold above is fitted on the same 40 questions it is scored on — so
  // the only honest check on false fires is messages nobody wrote for this test.
  // Read at runtime from DATABASE_URL; message text is never committed.
  if (withEmbed && process.env.DATABASE_URL) {
    const { sql } = await import("../../src/server/db.ts");
    const rows = (await sql`SELECT content FROM messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 500`) as { content: string }[];
    const { embed, cosineSim } = (await import("@ternlight/base")) as {
      embed: (t: string) => Float32Array;
      cosineSim: (a: Float32Array, b: Float32Array) => number;
    };
    const pos = FEATURES_PROTOTYPES.map(embed);
    const neg = ATLAS_PROTOTYPES.map(embed);
    const thr = config.chatSkillSimilarityMargin;
    const scored = rows.map((r) => {
      const q = r.content.slice(0, 300);
      const v = embed(q);
      return {
        q,
        regex: matchesFeaturesQuestion(q),
        gated: namesAtlasSubject(ix, q) || isSmallTalk(q),
        margin: Math.max(...pos.map((p) => cosineSim(v, p))) - Math.max(...neg.map((p) => cosineSim(v, p))),
      };
    });
    const newFires = scored.filter((r) => !r.regex && !r.gated && r.margin >= thr);
    console.log(`\nreal messages from DATABASE_URL: ${scored.length}`);
    console.log(`  regex fires on ${scored.filter((r) => r.regex).length}; margin>=${thr} adds ${newFires.length} more`);
    for (const r of newFires.slice(0, 12)) console.log(`  + ${r.margin.toFixed(3)}  ${r.q.slice(0, 90).replace(/\s+/g, " ")}`);
  }

  // What over-firing actually costs, in the only unit that matters here.
  const shipped = arms.find((a) => a.arm === "regex OR gated margin (all)");
  if (shipped) {
    const perTurn = ((shipped.fp / (shipped.fp + shipped.tn)) * WASTED_TOKENS_PER_FIRE).toFixed(0);
    console.log(
      `\ncost of over-firing at thr=${shipped.threshold}: ${shipped.fp} false fire(s) in ${shipped.fp + shipped.tn} non-product questions ` +
        `≈ ${perTurn} wasted tokens per atlas turn on average (vs ${WASTED_TOKENS_PER_FIRE} on every turn if the guide were always injected).`,
    );
  }

  // At a permissive threshold the margin barely discriminates and the
  // deterministic suppressors carry the precision. Show which does what.
  if (shipped && withEmbed) {
    const thr = shipped.threshold!;
    const negs = cases.filter((c) => !c.fire && !c.regex);
    const suppressed = negs.filter((c) => c.atlasSubject || c.smalltalk).length;
    const belowMargin = negs.filter((c) => !c.atlasSubject && !c.smalltalk && (c.posSim ?? 0) - (c.negSim ?? 0) < thr).length;
    console.log(`\nwhat holds back the ${negs.length} non-product questions the regex ignores, at thr=${thr}:`);
    console.log(`  ${suppressed} stopped by the suppressors (names an atlas subject / small talk)`);
    console.log(`  ${belowMargin} stopped by the margin`);
    console.log(`  ${shipped.fp} fire anyway:`);
    for (const q of shipped.falseFires) console.log(`    · ${q}`);
    console.log(`  positives still missed (${shipped.misses.length}): ${shipped.misses.join(" | ")}`);
  }

  console.log(`\nregex misses (what similarity would have to recover): ${regexArm.misses.length}`);
  for (const m of regexArm.misses) console.log(`  · ${m}`);

  const out = path.join(".cache", "eval-skills.json");
  fs.mkdirSync(".cache", { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), embedMsPerQuery: embedMs || null, arms, cases }, null, 2));
  console.log(`\nwrote ${out}`);
}

await main();
