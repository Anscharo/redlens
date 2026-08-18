// Offline bakeoff for the small-talk judge model (CHAT_SMALLTALK_JUDGE_MODEL).
// Runs the SHIPPED judge path — judgeSmalltalk's prompt, parse, timeout, and
// the production OpenRouter JsonCall — over a labeled set of marker-free
// messages (the deterministic prefilter guarantees only such messages ever
// reach the judge in production). Reports accuracy split by error direction:
// a false "smalltalk" on a factual question bypasses the audit (dangerous);
// a false "factual" on a greeting merely audits it (harmless). Usage:
//   bun scripts/aux/eval-smalltalk-judge.ts
import { judgeSmalltalk } from "../../src/server/chat/verify/smalltalk.ts";
import { openrouterJson } from "../../src/server/chat/llm.ts";
import fs from "node:fs";
import path from "node:path";

const MODELS = (process.env.JUDGE_MODELS ?? [
  "google/gemma-4-31b-it",
  "google/gemma-4-26b-a4b-it",
  "nvidia/nemotron-3.5-lightning-20260807:nitro",
  "openai/gpt-oss-safeguard-20b",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const PASSES = 2;
const CONCURRENCY = 6;

// Labels follow the shipped JUDGE_PROMPT semantics: true ONLY for pure
// conversation whose reply needs no factual content.
const SMALLTALK: string[] = [
  "hello", "Hi there!", "hey", "good morning", "thanks!",
  "thank you so much, that was really helpful", "ok great", "bye",
  "goodbye, have a nice day", "👋", "are you there?", "test",
  "how are you?", "lol", "cool, thanks. you're pretty good at this",
];
const FACTUAL: string[] = [
  "is the stability fee controlled by governance?", "does sky have a treasury?",
  "who runs the protocol?", "what can you do?", "who are you?", "help",
  "can you summarize the atlas?", "what is a scope?", "tell me about facilitators",
  "how do payments work?", "is there a rewards program?",
  "hey, quick question — who approves budgets?",
  "thanks! also, what is an executor agent?", "yo what's the deal with multisigs",
  "explain governance to me", "are stablecoins risky?", "should I trust this protocol?",
  "what changed recently?", "where can I find the rules about penalties?",
  "do facilitators get paid?", "hola, ¿qué es un scope?",
  "how does this compare to maker?", "give me a quick overview", "what's new?",
  "is the atlas up to date?", "any updates?", "anything interesting happen lately?",
];

interface CaseResult { q: string; expected: boolean; got: boolean; failed: boolean; latencyMs: number | null }

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

const cases = [
  ...SMALLTALK.map((q) => ({ q, expected: true })),
  ...FACTUAL.map((q) => ({ q, expected: false })),
];

const report: Record<string, unknown> = {};
for (const model of MODELS) {
  const runs = cases.flatMap((c) => Array.from({ length: PASSES }, () => c));
  const t0 = Date.now();
  const results: CaseResult[] = await pool(runs, CONCURRENCY, async (c) => {
    const r = await judgeSmalltalk({ call: openrouterJson, model, question: c.q });
    return { q: c.q, expected: c.expected, got: r.smalltalk, failed: r.usage === null, latencyMs: r.latencyMs };
  });
  const wall = Date.now() - t0;

  const ok = results.filter((r) => !r.failed);
  const correct = ok.filter((r) => r.got === r.expected);
  // Dangerous direction: judge says smalltalk on a factual question → bypass.
  const dangerous = ok.filter((r) => !r.expected && r.got);
  // Harmless direction: greeting ruled factual → it just gets audited.
  const missed = ok.filter((r) => r.expected && !r.got);
  const lats = ok.map((r) => r.latencyMs!).filter((n) => n != null);

  console.log(`\n=== ${model} ===`);
  console.log(
    `calls ${results.length} | failures ${results.length - ok.length} | accuracy ${pct(correct.length, ok.length)}` +
      ` | DANGEROUS smalltalk-on-factual ${dangerous.length}/${PASSES * FACTUAL.length} (${pct(dangerous.length, PASSES * FACTUAL.length)})` +
      ` | missed smalltalk ${missed.length}/${PASSES * SMALLTALK.length}`,
  );
  console.log(`latency p50 ${quantile(lats, 0.5)}ms | p95 ${quantile(lats, 0.95)}ms | wall ${wall}ms`);
  const wrong = [...new Set([...dangerous, ...missed].map((r) => `${r.expected ? "[missed]" : "[DANGER]"} ${r.q}`))];
  for (const w of wrong) console.log(`  ${w}`);
  if (results.length - ok.length > 0) {
    const failedQs = [...new Set(results.filter((r) => r.failed).map((r) => r.q))];
    console.log(`  [call-failures] ${failedQs.slice(0, 5).join(" | ")}${failedQs.length > 5 ? " …" : ""}`);
  }
  report[model] = {
    calls: results.length, failures: results.length - ok.length,
    accuracy: ok.length ? correct.length / ok.length : null,
    dangerousFalsePositives: dangerous.length, missedSmalltalk: missed.length,
    p50: quantile(lats, 0.5), p95: quantile(lats, 0.95), wallMs: wall,
    wrong, results,
  };
}

const outPath = path.join(".cache", "eval-smalltalk-judge.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nwrote ${outPath}`);
