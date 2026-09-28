// One tool-choice eval run: production's pre-first-token assembly
// (prepareTurn — Jev judgement, tier routing, system prompt, history window,
// facts round) feeding production's tool loop (runChat), real models through
// the routed OpenRouter chain, ending at the model's first answer.
//
// runChat, not runVerifiedChat: the harness around it only rewrites the events
// the client sees (link gate) and audits the finished answer — small-talk Jev
// judge, paragraph refuter, verifier, citation marks — none of which changes a
// byte the MODEL reads, and all of which would spend. What runChat itself
// needs is passed exactly as runVerifiedChat passes it: the routed round
// budget, the user question, and a jsonCall — used inside runChat only by the
// ask_external_msc sub-agent, which without one returns a "skipped" brief that
// production never serves.
import type { Indexes } from "../../src/server/retrieval/indexes.ts";
import { prepareTurn } from "../../src/server/chat/turn-setup.ts";
import type { ModelTier, Route } from "../../src/server/chat/model-router.ts";
import { runChat, type ChatStream, type RoundInfo } from "../../src/server/chat/chat-loop.ts";
import { makeOpenrouterJson, makeOpenrouterStream, type JsonCall } from "../../src/server/chat/llm.ts";
import type { PageContext } from "../../src/server/chat/system-prompt.ts";
import { emptiedByFilters, isEmptyResult, scoreRun, type ObservedCall, type RunScore, type ToolCase } from "./eval-tools-score.ts";

export type Arm = "routed" | ModelTier;

export interface RunRecord {
  id: string;
  arm: Arm;
  pass: number;
  /** Tier the run used, and what production routing chose for it. */
  route: Route;
  routed: Route;
  models: string[];
  maxIterations: number;
  /** Models OpenRouter actually served (chunk.model), in order seen — a
   *  fallback in the chain answering instead of the primary shows up here. */
  servedModels: string[];
  jev: { landed: boolean; complexity: number | null; latencyMs: number; costUsd: number | null };
  facts: string[];
  calls: ObservedCall[];
  /** Model requests this turn (tool rounds + the answer round + any guard retry). */
  requests: number;
  score: RunScore | null;
  answer: string;
  latencyMs: number;
  usage: { input: number; output: number };
  /** Chat-stream spend as OpenRouter reports it (usage.cost), USD. */
  costUsd: number;
  /** ask_external_msc helper tokens — its cost is not reported per call. */
  subagentTokens: number;
  error: string | null;
  /** Set when a forced-default record is the routed run reused (same chain, same prompt). */
  reusedFrom?: "routed";
}

const DOC_REF_RE = /\{(doc_no|title):([0-9a-f-]{36})\}/g;

export function resolveCase(ix: Indexes, c: ToolCase): { q: string; pageContext?: PageContext } {
  const node = (uuid: string) => {
    const n = ix.docMap.get(uuid);
    if (!n) throw new Error(`stale case ${c.id}: ${uuid} is not in the served atlas`);
    return n;
  };
  const q = c.q.replace(DOC_REF_RE, (_, field: string, uuid: string) => (field === "doc_no" ? node(uuid).doc_no : node(uuid).title));
  if (!c.pageNode) return { q, pageContext: c.pageContext };
  const n = node(c.pageNode);
  return { q, pageContext: { path: "/atlas", nodeId: n.id, nodeTitle: n.title, nodeDocNo: n.doc_no } };
}

// Long string args (export_findings carries a whole file) are clipped in the record.
const clip = (args: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}…` : v]));

export async function runCase(opts: { ix: Indexes; c: ToolCase; arm: Arm; pass: number; timeoutMs: number }): Promise<RunRecord> {
  const { ix, c, arm, pass } = opts;
  const started = Date.now();
  const sink = { served: [] as string[], cost: 0, requests: 0, subagentTokens: 0 };
  const calls: ObservedCall[] = [];
  const blank: RunRecord = {
    id: c.id, arm, pass, route: { tier: "default", reason: "" }, routed: { tier: "default", reason: "" }, models: [], maxIterations: 0,
    servedModels: [], jev: { landed: false, complexity: null, latencyMs: 0, costUsd: null }, facts: [], calls, requests: 0,
    score: null, answer: "", latencyMs: 0, usage: { input: 0, output: 0 }, costUsd: 0, subagentTokens: 0, error: null,
  };
  let rec = blank;
  try {
    const { q, pageContext } = resolveCase(ix, c);
    const history = [...(c.history ?? []), { role: "user" as const, content: q }];
    const turn = await prepareTurn({ ix, message: q, history, pageContext, forceTier: arm === "routed" ? undefined : arm });
    rec = {
      ...blank, route: turn.route, routed: turn.routed, models: turn.models, maxIterations: turn.maxIterations,
      jev: { landed: turn.judgement !== null, complexity: turn.judgement?.complexity ?? null, latencyMs: turn.jevLatencyMs, costUsd: turn.judgement?.costUsd ?? null },
      facts: turn.facts?.used.map((u) => u.id) ?? [],
    };
    // One conversation per run: session_id (provider stickiness) is keyed on it, as in production.
    const obs = { distinctId: `eval-tools:${c.id}:${arm}:${pass}` };
    const base = makeOpenrouterStream(obs, turn.models);
    const stream: ChatStream = async function* (p) {
      sink.requests++;
      for await (const chunk of base(p)) {
        if (chunk.model && !sink.served.includes(chunk.model)) sink.served.push(chunk.model);
        const cost = (chunk.usage as { cost?: unknown } | undefined)?.cost;
        if (typeof cost === "number") sink.cost += cost;
        yield chunk;
      }
    };
    const baseJson = makeOpenrouterJson(obs, "eval-tools-msc");
    const jsonCall: JsonCall = async (a) => {
      const r = await baseJson(a);
      sink.subagentTokens += r.usage.input + r.usage.output;
      return r;
    };
    const onRoundEnd = (info: RoundInfo) =>
      info.calls.forEach((call, i) => {
        const r = info.results[i];
        calls.push({ name: call.name, args: clip(call.args), round: info.iter, ok: r?.ok ?? false, empty: r ? isEmptyResult(r.content) : false, emptyByFilters: r ? emptiedByFilters(r.content) : false });
      });
    const signal = AbortSignal.timeout(opts.timeoutMs);
    for await (const ev of runChat({ ix, messages: turn.messages, stream, signal, maxIterations: turn.maxIterations, onRoundEnd, jsonCall, userQuestion: q })) {
      if (ev.type === "done") {
        rec.answer = ev.content.slice(0, 1500);
        rec.usage = ev.usage;
      }
    }
    // An empty answer is a result (its tool choice still counts), a timeout is not.
    if (signal.aborted) rec.error = `timeout after ${opts.timeoutMs / 1000}s`;
  } catch (e) {
    rec.error = e instanceof Error ? e.message : String(e);
  }
  return {
    ...rec, servedModels: sink.served, requests: sink.requests, costUsd: sink.cost, subagentTokens: sink.subagentTokens,
    score: scoreRun(c, calls, rec.facts), latencyMs: Date.now() - started,
  };
}
