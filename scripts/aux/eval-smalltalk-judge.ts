// Offline bakeoff for the small-talk judge seat (CHAT_SMALLTALK_JUDGE_MODEL).
// Runs the SHIPPED judge path for each arm — judgeSmalltalk's prompt/parse/
// timeout over the production OpenRouter JsonCall for a chat model,
// judgeSmalltalkJev's Noul over the production /systemone client for Jev — so
// this measures the functions the server would actually run, never a
// reimplementation. Cases: scripts/aux/eval-smalltalk-cases.ts.
//
// Reports accuracy split by ERROR DIRECTION, because the two are not
// symmetric: a false "smalltalk" on a factual question bypasses the audit
// (DANGEROUS); a false "factual" on a greeting merely audits it (harmless).
// The bypass is fail-closed by design, so the operating point for a
// probability-valued arm is set from the dangerous side: the LOWEST threshold
// at which no factual case is ruled small talk. (Lowest, not highest —
// raising the threshold only ever removes dangerous errors, so the smallest
// threshold that reaches zero is the one that keeps the most greeting recall.)
//
// Usage:  bun scripts/aux/eval-smalltalk-judge.ts
//         JUDGE_MODELS="google/gemma-4-26b-a4b-it,typesafe/jev-1.13" bun …
import { judgeSmalltalk } from "../../src/server/chat/verify/smalltalk.ts";
import { judgeSmalltalkJev, SMALLTALK_JEV_THRESHOLD } from "../../src/server/chat/verify/smalltalk-jev.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import { CASES } from "./eval-smalltalk-cases.ts";
import fs from "node:fs";
import path from "node:path";

const MODELS = (process.env.JUDGE_MODELS ?? ["google/gemma-4-26b-a4b-it", "typesafe/jev-1.13"].join(","))
  .split(",").map((s) => s.trim()).filter(Boolean);
const PASSES = Number(process.env.JUDGE_PASSES ?? 2);
const CONCURRENCY = 6;
const isJev = (m: string) => m.startsWith("typesafe/");

interface CaseResult {
  q: string; expected: boolean; hard: boolean;
  got: boolean; p: number | null; failed: boolean;
  latencyMs: number | null; costUsd: number | null;
}

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

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** Counts at one decision rule, over any slice of results. */
function tally(rs: CaseResult[], fired: (r: CaseResult) => boolean) {
  const ok = rs.filter((r) => !r.failed);
  const dangerous = ok.filter((r) => !r.expected && fired(r));
  const missed = ok.filter((r) => r.expected && !fired(r));
  const correct = ok.length - dangerous.length - missed.length;
  return { n: ok.length, correct, dangerous, missed, factual: ok.filter((r) => !r.expected).length, small: ok.filter((r) => r.expected).length };
}

function reportSlice(label: string, rs: CaseResult[], fired: (r: CaseResult) => boolean) {
  const t = tally(rs, fired);
  console.log(
    `  ${label.padEnd(12)} n=${String(t.n).padStart(3)}  accuracy ${pct(t.correct, t.n).padStart(6)}` +
      `  DANGEROUS ${String(t.dangerous.length).padStart(2)}/${String(t.factual).padStart(3)} (${pct(t.dangerous.length, t.factual)})` +
      `  missed-smalltalk ${String(t.missed.length).padStart(2)}/${t.small}`,
  );
  return t;
}

const runs = CASES.flatMap((c) => Array.from({ length: PASSES }, () => c));
const report: Record<string, unknown> = {};

for (const model of MODELS) {
  const t0 = Date.now();
  const results: CaseResult[] = await pool(runs, CONCURRENCY, async (c) => {
    if (isJev(model)) {
      // threshold 0 keeps the raw probability meaningful for the sweep; the
      // boolean this arm returns here is ignored in favour of p >= thr below.
      const r = await judgeSmalltalkJev({ question: c.q, model, threshold: 0 });
      return { q: c.q, expected: c.expected, hard: c.hard, got: r.smalltalk, p: r.p, failed: r.p === null, latencyMs: r.latencyMs, costUsd: r.costUsd };
    }
    const r = await judgeSmalltalk({ call: openrouterJson, model, question: c.q });
    return { q: c.q, expected: c.expected, hard: c.hard, got: r.smalltalk, p: null, failed: r.usage === null, latencyMs: r.latencyMs, costUsd: null };
  });
  const wall = Date.now() - t0;
  const ok = results.filter((r) => !r.failed);
  const lats = ok.map((r) => r.latencyMs!).filter((n) => n != null);
  const cost = ok.reduce((s, r) => s + (r.costUsd ?? 0), 0);

  console.log(`\n=== ${model} ===`);
  console.log(`calls ${results.length} | failures ${results.length - ok.length} | latency p50 ${quantile(lats, 0.5)}ms p95 ${quantile(lats, 0.95)}ms | wall ${wall}ms` + (cost ? ` | cost $${cost.toFixed(5)} ($${(cost / ok.length).toFixed(7)}/call)` : ""));

  let sweep: { thr: number; dangerous: number; missed: number }[] = [];
  let operating: number | null = null;
  let fired = (r: CaseResult) => r.got;

  if (isJev(model)) {
    // The threshold is OURS — sweep it and pick from the dangerous side.
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const thr = Number(t.toFixed(2));
      const s = tally(ok, (r) => (r.p ?? 0) >= thr);
      sweep.push({ thr, dangerous: s.dangerous.length, missed: s.missed.length });
    }
    const clean = sweep.filter((s) => s.dangerous === 0);
    operating = clean.length ? clean[0].thr : null;
    console.log("  threshold sweep (dangerous / missed-smalltalk), * = SHIPPED (SMALLTALK_JEV_THRESHOLD):");
    console.log("   " + sweep.map((s) => `${Math.abs(s.thr - SMALLTALK_JEV_THRESHOLD) < 0.025 ? "*" : ""}${s.thr.toFixed(2)}:${s.dangerous}/${s.missed}`).join("  "));
    // The real bar: the highest probability any FACTUAL case drew. A usable
    // threshold must sit above it, and greeting recall there is the cost.
    const maxFactualP = Math.max(...ok.filter((r) => !r.expected).map((r) => r.p ?? 0));
    const minSmallP = Math.min(...ok.filter((r) => r.expected).map((r) => r.p ?? 1));
    console.log(`  separation: highest P(smalltalk) on a FACTUAL case = ${maxFactualP.toFixed(3)} | lowest on a SMALL-TALK case = ${minSmallP.toFixed(3)}` +
      (minSmallP > maxFactualP ? "  → fully separable" : "  → OVERLAP, no threshold is clean"));
    console.log(`  operating point (lowest threshold with 0 dangerous): ${operating === null ? "NONE — Jev loses this seat on these cases" : operating.toFixed(2)}`);
    // Score at the SHIPPED constant, not at the point this run just fitted —
    // the eval must measure the rule the server would actually apply
    // (eval-census.ts's rule). The fitted point is printed above for contrast;
    // it is in-sample, and the real held-out check is real traffic.
    console.log(`  scoring below at the SHIPPED threshold ${SMALLTALK_JEV_THRESHOLD} (fitted point shown above for contrast — it is in-sample)`);
    fired = (r) => (r.p ?? 0) >= SMALLTALK_JEV_THRESHOLD;
    report[`${model}:sweep`] = { sweep, operating, shipped: SMALLTALK_JEV_THRESHOLD, maxFactualP, minSmallP };
  }

  const all = reportSlice("ALL", ok, fired);
  reportSlice("base(42)", ok.filter((r) => !r.hard), fired);
  reportSlice("HARD", ok.filter((r) => r.hard), fired);

  const wrong = [...new Set([...all.dangerous, ...all.missed].map((r) => `${r.expected ? "[missed]" : "[DANGER]"} ${r.hard ? "(hard) " : ""}${r.q}${r.p === null ? "" : ` p=${r.p.toFixed(2)}`}`))].sort();
  for (const w of wrong) console.log(`    ${w}`);
  if (results.length - ok.length > 0) {
    const failedQs = [...new Set(results.filter((r) => r.failed).map((r) => r.q))];
    console.log(`  [call-failures] ${failedQs.slice(0, 5).join(" | ")}${failedQs.length > 5 ? " …" : ""}`);
  }

  report[model] = {
    calls: results.length, failures: results.length - ok.length,
    accuracy: all.n ? all.correct / all.n : null,
    dangerousFalsePositives: all.dangerous.length, missedSmalltalk: all.missed.length,
    operatingThreshold: operating,
    p50: quantile(lats, 0.5), p95: quantile(lats, 0.95), wallMs: wall, costUsd: cost || null,
    wrong, results,
  };
}

const outPath = path.join(".cache", "eval-smalltalk-judge.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nwrote ${outPath}`);
