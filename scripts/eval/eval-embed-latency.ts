#!/usr/bin/env bun
/**
 * Embedding latency bakeoff: how long one search's embed call takes per model.
 *
 *   bun scripts/eval/eval-embed-latency.ts --models qwen/qwen3-embedding-8b,openai/text-embedding-3-small --queries 60
 *   bun scripts/eval/eval-embed-latency.ts --models qwen/qwen3-embedding-8b --ollama qwen3-embedding:0.6b
 *
 * Each query call sends what a reader's search sends: two texts in one request
 * (the query and the lexical residual, `embedQueries`), `dimensions: 1024`. The
 * query carries each model's own prefix (`queryPrefixFor`), as in production. Models
 * take turns query by query, so a slow minute on the network lands on every
 * model alike. One warm-up call per model is left out of the numbers. The
 * provider OpenRouter routed each call to is counted, because one model id can
 * reach hosts with very different latency. A batch of 50 unit texts per model
 * (three runs) stands for the worker's sync after an atlas update.
 *
 * `model@Host` pins one OpenRouter host (`provider.order`, no fallback), to
 * tell a slow model from a slow host when one id routes to several.
 *
 * `--ollama` adds local models through Ollama's /api/embed. Their numbers are
 * this machine's CPU and GPU, not a hosted round trip, so compare them with
 * each other and not with the OpenRouter rows. The same holds for every row
 * against production: this measures from the machine it runs on.
 */
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode } from "../../src/types.ts";
import { config, queryPrefixFor } from "../../src/server/config.ts";
import { openrouterAttributionHeaders } from "../../src/server/openrouter-attribution.ts";
import { buildUnits } from "../../src/server/retrieval/embed-units.ts";
import { generateRetrievalQueries } from "./eval-retrieval-queries.ts";
import { keywordQuery } from "./eval-retrieval-rank.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]!] : []))[0];
const MODELS = (flag("models") ?? config.embedModel).split(",").filter(Boolean);
const OLLAMA = (flag("ollama") ?? "").split(",").filter(Boolean);
const N = Number(flag("queries") ?? 60);
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const OUT = flag("out") ?? path.join(ROOT, ".cache", "eval-embed-latency.json");

interface Call {
  ms: number;
  provider: string;
  error?: string;
}

async function openrouter(arm: string, input: string[]): Promise<Call> {
  const [model, host] = arm.split("@");
  const provider = host ? { order: [host], allow_fallbacks: false } : undefined;
  const t0 = performance.now();
  try {
    const res = await fetch(`${config.openrouterBaseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openrouterApiKey}`,
        "content-type": "application/json",
        ...openrouterAttributionHeaders(),
      },
      body: JSON.stringify({ model, input, dimensions: 1024, provider }),
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    if (!res.ok) return { ms, provider: "error", error: `${res.status} ${text.slice(0, 160)}` };
    const json = JSON.parse(text) as { provider?: string; data?: unknown[] };
    if (json.data?.length !== input.length) return { ms, provider: "error", error: `got ${json.data?.length} vectors` };
    return { ms, provider: json.provider ?? "unknown" };
  } catch (e) {
    return { ms: performance.now() - t0, provider: "error", error: (e as Error).message };
  }
}

async function ollama(model: string, input: string[]): Promise<Call> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${OLLAMA_HOST}/api/embed`, { method: "POST", body: JSON.stringify({ model, input }) });
    const json = (await res.json()) as { embeddings?: unknown[]; error?: string };
    const ms = performance.now() - t0;
    if (json.error || json.embeddings?.length !== input.length) return { ms, provider: "error", error: json.error ?? "count" };
    return { ms, provider: "local" };
  } catch (e) {
    return { ms: performance.now() - t0, provider: "error", error: (e as Error).message };
  }
}

const arms = [
  ...MODELS.map((m) => ({ name: m, model: m.split("@")[0]!, call: (input: string[]) => openrouter(m, input) })),
  ...OLLAMA.map((m) => ({ name: `ollama:${m}`, model: m, call: (input: string[]) => ollama(m, input) })),
];

const docs = Object.values(
  (JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")) as { nodes: Record<string, AtlasNode> }).nodes,
);
const generated = generateRetrievalQueries(docs).map((q) => q.query);
// Half question-shaped, half keyword-shaped, the two shapes the retrieval eval scores.
const queries = Array.from({ length: N }, (_, i) => {
  const q = generated[Math.floor(i / 2) % generated.length]!;
  return i % 2 ? keywordQuery(q) : q;
});
const inputFor = (q: string, model: string) => [`${queryPrefixFor(model)}${q}`, keywordQuery(q)];

function summary(calls: Call[]) {
  const ok = calls.filter((c) => !c.error).map((c) => c.ms).sort((a, b) => a - b);
  const pct = (p: number) => (ok.length ? Math.round(ok[Math.min(ok.length - 1, Math.floor(p * ok.length))]!) : NaN);
  const providers: Record<string, string> = {};
  for (const p of new Set(calls.map((c) => c.provider))) {
    const ms = calls.filter((c) => c.provider === p).map((c) => c.ms).sort((a, b) => a - b);
    const at = (q: number) => Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))]!);
    providers[p] = `${ms.length}× p50 ${at(0.5)} p90 ${at(0.9)}`;
  }
  return { n: calls.length, errors: calls.length - ok.length, p50: pct(0.5), p90: pct(0.9), min: Math.round(ok[0] ?? NaN), providers };
}

const results: Record<string, { query: ReturnType<typeof summary>; batch50: ReturnType<typeof summary>; firstError?: string }> = {};
const queryCalls = new Map(arms.map((a) => [a.name, [] as Call[]]));

for (const arm of arms) {
  const warm = await arm.call(inputFor("warm up", arm.model));
  if (warm.error) console.warn(`  ${arm.name} warm-up failed: ${warm.error}`);
}
for (let i = 0; i < queries.length; i++) {
  for (const arm of arms) queryCalls.get(arm.name)!.push(await arm.call(inputFor(queries[i]!, arm.model)));
  if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${queries.length} queries`);
}

const unitTexts = buildUnits(docs, "kv_records_breadcrumbs").slice(0, 150).map((u) => u.text);
for (const arm of arms) {
  const batch: Call[] = [];
  for (let r = 0; r < 3; r++) batch.push(await arm.call(unitTexts.slice(r * 50, r * 50 + 50)));
  const calls = queryCalls.get(arm.name)!;
  results[arm.name] = {
    query: summary(calls),
    batch50: summary(batch),
    firstError: [...calls, ...batch].find((c) => c.error)?.error,
  };
}

console.log("\nmodel                                    query p50   p90   min  err | batch50 p50 | providers");
for (const [name, r] of Object.entries(results)) {
  const prov = Object.entries(r.query.providers).map(([p, d]) => `${p} ${d}`).join("; ");
  console.log(
    `${name.padEnd(40)} ${String(r.query.p50).padStart(9)} ${String(r.query.p90).padStart(5)} ${String(r.query.min).padStart(5)} ${String(r.query.errors).padStart(4)} | ${String(r.batch50.p50).padStart(11)} | ${prov}`,
  );
  if (r.firstError) console.log(`  first error: ${r.firstError}`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ queries: queries.length, results }, null, 2));
console.log(`\nwrote ${path.relative(ROOT, OUT)}`);
