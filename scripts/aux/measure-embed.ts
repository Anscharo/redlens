// Embed-latency measurement — decides how to fix the silent semantic-leg
// degradation (search.ts races embedQuery against semanticEmbedTimeoutMs=4s;
// the 2026-08-06 wiki A/B saw ~1/3 of turns degrade to lexical-only).
// Measures the TRUE latency distribution of the embeddings endpoint so the fix
// is picked from data: raise the cap (p50 high) / retry-once (outliers only) /
// pacing (concurrency-triggered 429s) / warmup (cold-start only).
//
//   bun scripts/aux/measure-embed.ts            # ~90 calls, ≈2-3 min
//   bun scripts/aux/measure-embed.ts --n 20     # calls per phase
import { config } from "../../src/server/config.ts";
import { embedBatch } from "../../src/server/retrieval/embed.ts";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
const N = Number(flag("n")[0] ?? 30);
const CAP = config.semanticEmbedTimeoutMs;

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}

// Unique realistic queries (templates × entities × qualifier) — uniqueness
// bypasses both the in-process LRU and any provider-side response caching.
const TEMPLATES = [
  "what is the %E capital ratio requirement",
  "%E USDS minting rate limit maxAmount slope",
  "who can change the %E agent artifact thresholds",
  "%E distribution reward payment registry entries",
  "emergency response multisig threshold exception %E",
  "spell reviewer prohibitions pull request %E",
  "%E liquidity layer admin role governance control",
  "monthly governance cycle december schedule %E",
  "%E risk council review period silence advances",
  "lawyer registry approved legal counsels %E",
];
const ENTITIES = ["Spark", "Grove", "Keel", "Skybase", "Obex", "Pattern", "Launch Agent 7", "Sky Core", "Accessibility Scope", "Stability Scope"];
const queries: string[] = [];
for (let i = 0; queries.length < 1 + N * 3; i++) {
  const t = TEMPLATES[i % TEMPLATES.length];
  const e = ENTITIES[Math.floor(i / TEMPLATES.length) % ENTITIES.length];
  queries.push(`${t.replace("%E", e)} v${i}`);
}
let qi = 0;
const nextQuery = () => queries[qi++];

// Count embedBatch's internal retry warnings per phase.
let retries = 0;
const realWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("embed retry")) retries++;
  else realWarn(...args);
};

interface Sample { ms: number; ok: boolean; err?: string }

async function one(): Promise<Sample> {
  const started = Date.now();
  try {
    await embedBatch([nextQuery()], AbortSignal.timeout(30_000));
    return { ms: Date.now() - started, ok: true };
  } catch (e) {
    return { ms: Date.now() - started, ok: false, err: (e as Error).message.slice(0, 80) };
  }
}

async function pool(count: number, concurrency: number): Promise<Sample[]> {
  const out: Sample[] = [];
  let launched = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (launched < count) {
        launched++;
        out.push(await one());
      }
    }),
  );
  return out;
}


const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] ?? 0;
};

function report(label: string, samples: Sample[], phaseRetries: number) {
  const ok = samples.filter((s) => s.ok).map((s) => s.ms);
  const errs = samples.filter((s) => !s.ok);
  const over = samples.filter((s) => s.ms > CAP).length;
  console.log(`\n── ${label} (${samples.length} calls) ──`);
  if (ok.length) {
    console.log(
      `  p50 ${pct(ok, 50)}ms  p90 ${pct(ok, 90)}ms  p95 ${pct(ok, 95)}ms  p99 ${pct(ok, 99)}ms  max ${Math.max(...ok)}ms`,
    );
  }
  console.log(`  over current ${CAP}ms cap: ${over}/${samples.length}  errors: ${errs.length}  internal retries: ${phaseRetries}`);
  for (const e of errs.slice(0, 3)) console.log(`    err after ${e.ms}ms: ${e.err}`);
}

console.log(`embed measurement — model=${config.embedModel} base=${config.openrouterBaseUrl}`);
console.log(`current semanticEmbedTimeoutMs=${CAP}  n=${N}/phase`);

const mark = () => { const r = retries; retries = 0; return r; };

const cold = [await one()];
report("cold (first call in process)", cold, mark());

const warm = await pool(N, 1);
report("warm sequential", warm, mark());

const c3 = await pool(N, 3);
report(`concurrent ×3`, c3, mark());

const c6 = await pool(N, 6);
report(`concurrent ×6`, c6, mark());

console.warn = realWarn;

// Verdict hints, mapped to the fix each finding implies.
const warmOk = warm.filter((s) => s.ok).map((s) => s.ms);
const c6over = c6.filter((s) => s.ms > CAP).length;
console.log(`\n── hints ──`);
if (pct(warmOk, 50) > CAP) console.log(`  p50 exceeds the cap → the cap is simply too low for this provider; raise it.`);
else if (pct(warmOk, 95) > CAP) console.log(`  p50 fits but p95 blows the cap → outliers; retry-once-fast or a modest cap bump.`);
else console.log(`  warm solo fits comfortably under the cap.`);
if (c6over > c6.length / 4) console.log(`  concurrency inflates latency/timeouts → provider rate limiting; backoff (1s/2s/4s/8s) loses the 4s race — consider pacing or a first-retry-fast policy.`);
if (cold[0].ms > CAP) console.log(`  cold call exceeds the cap → warm the embed path at boot.`);
