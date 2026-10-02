// Real-traffic check for the small-talk judge seat — the HELD-OUT half of
// eval-smalltalk-judge.ts, whose 84 cases and 0.65 threshold are both
// in-sample. Nobody wrote these messages for this test, which is the only
// property that matters here.
//
// Population = exactly what reaches the judge in production, reproduced with
// the production predicates, not approximated: the FIRST user message of a
// conversation (chat-orchestrator.ts gates on `<= 1` prior user messages) that
// `isUncheckableAnswer` passes (the deterministic prefilter). Messages that
// never reach the judge cannot tell us anything about it.
//
// There are no labels here. The decisive output is therefore NOT an accuracy
// score but whether the separation found on the labeled set SURVIVES: the
// labeled runs put no factual case above 0.52 and no small-talk case below
// 0.75, and the shipped threshold sits in that gap. Real messages landing
// INSIDE the gap mean the gap was an artefact of hand-written cases and the
// threshold is fragile. Second output: every disagreement between the arms,
// printed for adjudication.
//
// SENDS REAL STORED USER MESSAGES TO OPENROUTER. Run it deliberately.
//   DATABASE_URL=… bun scripts/aux/eval-smalltalk-real.ts
import { isUncheckableAnswer } from "../../src/server/chat/verify/smalltalk.ts";
import { judgeSmalltalkJev, SMALLTALK_JEV_THRESHOLD } from "../../src/server/chat/verify/smalltalk-jev.ts";
import { config } from "../../src/server/config.ts";
import { sql } from "../../src/server/db.ts";
import fs from "node:fs";
import path from "node:path";

const JEV = process.env.JUDGE_JEV ?? config.chatSmalltalkJudgeModel;
const LIMIT = Number(process.env.JUDGE_LIMIT ?? 400);
const CONCURRENCY = 4;
// "first" = the original one-call-per-conversation population. "later" = the
// messages the multi-turn expansion newly exposes, which NO first-turn result
// can speak for — the labeled set, the hard tier and the first-turn real
// check were all first messages. "all" = both.
const POPULATION = (process.env.JUDGE_POPULATION ?? "first") as "first" | "later" | "all";

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx]);
      }
    }),
  );
  return out;
}

const clean = (s: string) => s.slice(0, 100).replace(/\s+/g, " ");

const rows = (await sql`
  SELECT content, row_number() OVER (PARTITION BY conversation_id ORDER BY created_at ASC) AS turn
  FROM messages WHERE role = ${"user"}
`) as { content: string; turn: number }[];

const wanted = rows.filter((r) =>
  POPULATION === "all" ? true : POPULATION === "first" ? Number(r.turn) === 1 : Number(r.turn) > 1,
);
const texts = wanted.map((r) => r.content).filter((c) => typeof c === "string" && c.trim().length > 0);
const eligible = [...new Set(texts.filter((c) => isUncheckableAnswer(c)).map((c) => c.trim()))].slice(0, LIMIT);

console.log(`population "${POPULATION}" | user messages ${rows.length} | in population ${texts.length}`);
console.log(`reach the judge (marker-free, distinct): ${eligible.length}`);
if (!eligible.length) {
  console.log("nothing to score — no eligible messages in this database.");
  process.exit(0);
}

interface Row { q: string; jevP: number | null; jev: boolean; jevMs: number | null; cost: number | null }

const results: Row[] = await pool(eligible, CONCURRENCY, async (q) => {
  const j = await judgeSmalltalkJev({ question: q, model: JEV, threshold: 0 });
  return { q, jevP: j.p, jev: j.p !== null && j.p >= SMALLTALK_JEV_THRESHOLD, jevMs: j.latencyMs, cost: j.costUsd };
});

const scored = results.filter((r) => r.jevP !== null);
const q50 = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

console.log(`\nfailures ${results.length - scored.length}/${results.length} | latency p50 ${q50(scored.map((r) => r.jevMs!).filter(Boolean))}ms`);
console.log(`cost $${scored.reduce((s, r) => s + (r.cost ?? 0), 0).toFixed(5)} over ${scored.length} calls`);

// ── Does the separation gap survive? ──────────────────────────────────────
const GAP_LO = 0.52, GAP_HI = 0.75; // measured bounds on the labeled set
const inGap = scored.filter((r) => r.jevP! > GAP_LO && r.jevP! < GAP_HI);
const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01];
console.log(`\nP(smalltalk) distribution over real messages (shipped threshold ${SMALLTALK_JEV_THRESHOLD}):`);
for (let i = 0; i < buckets.length - 1; i++) {
  const n = scored.filter((r) => r.jevP! >= buckets[i] && r.jevP! < buckets[i + 1]).length;
  const bar = "█".repeat(Math.min(40, n));
  const marks = buckets[i] >= GAP_LO && buckets[i] < GAP_HI ? "  <- inside the labeled-set gap" : "";
  console.log(`  ${buckets[i].toFixed(1)}–${buckets[i + 1] > 1 ? "1.0" : buckets[i + 1].toFixed(1)}  ${String(n).padStart(4)} ${bar}${marks}`);
}
console.log(`\nSEPARATION: ${inGap.length} of ${scored.length} real messages fall inside the ${GAP_LO}–${GAP_HI} gap` +
  (inGap.length === 0 ? "  → gap SURVIVES on real traffic" : `  → gap is POPULATED; the threshold is not resting on empty space`));
for (const r of inGap.slice(0, 15)) console.log(`   p=${r.jevP!.toFixed(2)}  ${clean(r.q)}`);

// ── What would actually be bypassed ───────────────────────────────────────
// There are no labels, so this list IS the check: every message the audit
// would be skipped for, printed in full for adjudication. A wrong one here is
// the only error that costs trust.
const bypassed = scored.filter((r) => r.jev);
console.log(`\nWOULD BYPASS: ${bypassed.length} of ${scored.length} — read every one:`);
for (const r of bypassed.sort((a, b) => b.jevP! - a.jevP!)) console.log(`   p=${r.jevP!.toFixed(2)}  ${clean(r.q)}`);
// The near misses say how much room the threshold has on this traffic.
const near = scored.filter((r) => !r.jev && r.jevP! >= SMALLTALK_JEV_THRESHOLD - 0.25).sort((a, b) => b.jevP! - a.jevP!);
console.log(`\nclosest AUDITED messages (nothing here should look like pure small talk):`);
for (const r of near.slice(0, 10)) console.log(`   p=${r.jevP!.toFixed(2)}  ${clean(r.q)}`);

const out = path.join(".cache", "eval-smalltalk-real.json");
fs.mkdirSync(".cache", { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), model: JEV, population: POPULATION, threshold: SMALLTALK_JEV_THRESHOLD, counts: { eligible: eligible.length, bypassed: bypassed.length, inGap: inGap.length }, results }, null, 2));
console.log(`\nwrote ${out}`);
process.exit(0);
