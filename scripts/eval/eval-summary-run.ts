// Runs the real summarizer (summarizePrefix) on one thread with one model, and
// measures what that run cost. Only the model differs between candidates.
import { config } from "../../src/server/config.ts";
import { SUMMARY_MAX_CHARS, summarizePrefix } from "../../src/server/chat/context-summary.ts";
import { CHARS_PER_TOKEN, type ReplayRow } from "../../src/server/chat/context-compact.ts";
import type { JsonCall } from "../../src/server/chat/llm.ts";
import { shortHash, type Thread } from "./eval-summary-data.ts";
import { cachedFile, call } from "./eval-summary-judge.ts";

export interface SummaryRun {
  summary: string | null;
  error: string | null;
  latencyMs: number;
  calls: number;
  input: number;
  output: number;
  costUsd: number;
}

/** USD per million tokens (input, output) at list price; both double above 272k prompt tokens. */
const PRICES: Record<string, [number, number]> = {
  "openai/gpt-5.6-luna": [0.2, 1.2],
  "openai/gpt-6-luna": [0.1, 0.5],
};
const LONG_PROMPT_TOKENS = 272_000;

function callCost(model: string, input: number, output: number): number {
  const [pi, po] = PRICES[model] ?? [0, 0];
  const mult = input > LONG_PROMPT_TOKENS ? 2 : 1;
  return ((input * pi + output * po) / 1e6) * mult;
}

/** The server's chunk budget: 70% of the window, in characters (context-compact.ts compactForReplay). */
const BUDGET = Math.floor(config.chatContextWindowTokens * 0.7 * CHARS_PER_TOKEN);

async function summarizeOnce(model: string, prior: string | null, rows: ReplayRow[], acc: SummaryRun): Promise<string | null> {
  const metered: JsonCall = async (p) => {
    const res = await call(p);
    acc.calls++;
    acc.input += res.usage.input;
    acc.output += res.usage.output;
    acc.costUsd += callCost(model, res.usage.input, res.usage.output);
    return res;
  };
  return summarizePrefix(prior, rows, metered, model, BUDGET, config.chatSummaryTimeoutMs);
}

export async function runSummary(model: string, t: Thread, resume: boolean): Promise<SummaryRun> {
  const key = `${model.replace(/\W+/g, "_")}-cap${SUMMARY_MAX_CHARS}-${shortHash(JSON.stringify([t.id, t.rows.map((r) => r.id), t.rows.length, t.splitAt ?? 0]))}`;
  const store = cachedFile<SummaryRun>("summaries", key);
  const hit = resume ? store.get() : null;
  if (hit) return hit;
  const run: SummaryRun = { summary: null, error: null, latencyMs: 0, calls: 0, input: 0, output: 0, costUsd: 0 };
  const t0 = Date.now();
  try {
    if (t.splitAt) {
      const first = await summarizeOnce(model, null, t.rows.slice(0, t.splitAt), run);
      run.summary = first ? await summarizeOnce(model, first, t.rows.slice(t.splitAt), run) : null;
    } else {
      run.summary = await summarizeOnce(model, null, t.rows, run);
    }
  } catch (err) {
    run.error = err instanceof Error ? err.message : String(err);
  }
  run.latencyMs = Date.now() - t0;
  return store.put(run);
}

export const atCap = (summary: string | null): boolean => !!summary && summary.length >= SUMMARY_MAX_CHARS;
