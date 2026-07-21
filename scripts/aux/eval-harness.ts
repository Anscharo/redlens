// End-to-end harness eval — the one thing no other eval measures: does the
// ASSEMBLED reliability stack (verify → advise → revise) actually improve the
// answer, or just label it? Every other eval drives runChat; this drives
// runVerifiedChat exactly as chat.ts does.
//
// Measurement design — paired, within-turn, and free:
//   On an escalated turn the pre-revision answer IS what the raw loop would
//   have produced (same model, same sampling, same transcript), so
//   original-vs-final is a perfectly controlled A/B with no separate raw run
//   and no run-to-run noise. Non-escalated turns are unchanged by construction
//   (badge only), so:  net lift = escalation rate × mean delta on escalations.
//
// NO judge model: the load-bearing metrics here are deterministic (empty
// revisions, fabrications before/after, verdict transitions). Answer pairs are
// saved to the report for quality judging by the reader.
//
//   pnpm eval:harness                 # the core query set
//   pnpm eval:harness --only did-you-know
//   CHAT_VERIFIER_MODEL=… CHAT_ADVISOR_MODEL=… pnpm eval:harness   # slot override
import fs from "node:fs";
import path from "node:path";
import type OpenAI from "openai";
import { loadIndexes } from "../../src/server/indexes.ts";
import { buildSystemPrompt } from "../../src/server/system-prompt.ts";
import { runVerifiedChat, type CheckRowMeta } from "../../src/server/chat-orchestrator.ts";
import { makeOpenrouterStream, openrouterJson } from "../../src/server/llm.ts";
import { runDeterministicChecks } from "../../src/server/verify-checks.ts";
import { config } from "../../src/server/config.ts";
import { BAKEOFF_QUERIES, type BakeoffQuery } from "./eval-bakeoff-queries.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
const ONLY = new Set(flag("only"));
const CONCURRENCY = Number(flag("concurrency")[0] ?? 3);
const REPORT_PATH = path.join(ROOT, ".cache", "eval-harness.json");

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}
const queries = ONLY.size ? BAKEOFF_QUERIES.filter((q) => ONLY.has(q.id)) : BAKEOFF_QUERIES;
const ix = loadIndexes();

interface Result {
  id: string;
  escalated: boolean;
  recovered: boolean; // advisor returned a parsed recovery
  action: string | null; // requery | rewrite | decline
  revised: boolean; // revision produced content that replaced the original
  emptyRevision: boolean; // recovered but revision came back empty → original stands
  overallBefore: string | null;
  overallAfter: string | null;
  fabsBefore: number;
  fabsAfter: number;
  originalAnswer: string | null;
  finalAnswer: string;
  latencyMs: number;
  usage: { input: number; output: number };
  harnessTokens: number; // verifier + advisor overhead
  error: string | null;
}

const toolTextsOf = (t: Msg[]) => t.filter((m) => m.role === "tool" && typeof m.content === "string").map((m) => m.content as string);

// Ships-broken count, applied identically to both answers: what the reader
// would actually see wrong. Both are post-repair (the orchestrator repairs
// before the advisor row is written), so this is apples-to-apples. Caveat: on
// `requery` revisions the original is scored against evidence retrieved later,
// which flatters the original — a conservative bias for measuring lift.
function fabsOf(answer: string, toolTexts: string[]): number {
  const c = runDeterministicChecks(answer, toolTexts, ix);
  return c.invalidCitations.length + c.invalidDocNos.length + c.docNoMismatches.length + c.ungroundedQuotes.length;
}

async function runOne(q: BakeoffQuery): Promise<Result> {
  const started = Date.now();
  const base: Result = {
    id: q.id, escalated: false, recovered: false, action: null, revised: false, emptyRevision: false,
    overallBefore: null, overallAfter: null, fabsBefore: 0, fabsAfter: 0,
    originalAnswer: null, finalAnswer: "", latencyMs: 0, usage: { input: 0, output: 0 }, harnessTokens: 0, error: null,
  };
  try {
    const messages: Msg[] = [
      { role: "system", content: buildSystemPrompt(ix) },
      { role: "user", content: q.query },
    ];
    let done: (Extract<Awaited<ReturnType<typeof gen.next>>["value"], { type: "done" }> & { checksMeta: CheckRowMeta[] }) | null = null;
    const gen = runVerifiedChat({
      ix, messages, stream: makeOpenrouterStream({}, [config.chatModel]), jsonCall: openrouterJson,
      question: q.query, signal: AbortSignal.timeout(300_000), maxIterations: config.chatMaxIterations,
    });
    for await (const ev of gen) {
      if (ev.type === "done") done = ev as typeof done;
    }
    if (!done) throw new Error("no done event");

    const meta = done.checksMeta ?? [];
    const advisorRow = meta.find((m) => m.kind === "advisor_recovery");
    const verifyRow = meta.find((m) => m.kind === "verify");
    const recheckRow = meta.find((m) => m.kind === "verify_recheck");
    const advVerdict = advisorRow?.verdict as { action?: string; originalAnswer?: string } | null | undefined;
    const originalAnswer = advVerdict?.originalAnswer ?? null;
    const revised = Boolean(originalAnswer && originalAnswer !== done.content);
    const toolTexts = toolTextsOf(done.transcript);
    const harnessTokens = meta
      .filter((m) => m.kind === "verify" || m.kind === "verify_recheck" || m.kind === "advisor_recovery")
      .reduce((s, m) => s + (m.inputTokens ?? 0) + (m.outputTokens ?? 0), 0);

    return {
      ...base,
      escalated: Boolean(advisorRow),
      recovered: Boolean(advVerdict?.action),
      action: advVerdict?.action ?? null,
      revised,
      emptyRevision: Boolean(advVerdict?.action) && !revised,
      overallBefore: verifyRow?.overall ?? null,
      overallAfter: recheckRow?.overall ?? null,
      fabsBefore: originalAnswer ? fabsOf(originalAnswer, toolTexts) : fabsOf(done.content, toolTexts),
      fabsAfter: fabsOf(done.content, toolTexts),
      originalAnswer,
      finalAnswer: done.content,
      latencyMs: Date.now() - started,
      usage: done.usage,
      harnessTokens,
    };
  } catch (e) {
    return { ...base, latencyMs: Date.now() - started, error: e instanceof Error ? e.message : String(e) };
  }
}

const results: Result[] = [];
const save = () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify({
    ranAt: new Date().toISOString(),
    slots: { chat: config.chatModel, verifier: config.chatVerifierModel, advisor: config.chatAdvisorModel },
    results,
  }, null, 2));
};

console.log(`harness eval — chat=${config.chatModel} verifier=${config.chatVerifierModel || "(none)"} advisor=${config.chatAdvisorModel || "(none)"}`);
console.log(`${queries.length} queries\n`);

let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= queries.length) return;
    const r = await runOne(queries[i]);
    results.push(r);
    save();
    const tag = r.error ? `ERROR ${r.error.slice(0, 40)}`
      : !r.escalated ? "clean (no escalation)"
      : r.emptyRevision ? `ESCALATED → ${r.action} → EMPTY REVISION`
      : r.revised ? `escalated → ${r.action} → revised  fabs ${r.fabsBefore}→${r.fabsAfter}  ${r.overallBefore}→${r.overallAfter}`
      : `escalated → advisor gave nothing`;
    console.log(`[${results.length}/${queries.length}] ${r.id.padEnd(28)} ${tag}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

// ── Summary ────────────────────────────────────────────────────────────────
const ok = results.filter((r) => !r.error);
const esc = ok.filter((r) => r.escalated);
const rec = esc.filter((r) => r.recovered);
const rev = rec.filter((r) => r.revised);
const empty = rec.filter((r) => r.emptyRevision);
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "—");
const sum = (xs: Result[], f: (r: Result) => number) => xs.reduce((s, r) => s + f(r), 0);

console.log(`\n── harness end-to-end ──`);
console.log(`runs                ${ok.length}/${results.length} ok`);
console.log(`escalation rate     ${pct(esc.length, ok.length)} (${esc.length}/${ok.length})`);
console.log(`  advisor recovered ${pct(rec.length, esc.length)} (${rec.length}/${esc.length})`);
console.log(`  revision landed   ${pct(rev.length, rec.length)} (${rev.length}/${rec.length})`);
console.log(`  EMPTY revisions   ${pct(empty.length, rec.length)} (${empty.length}/${rec.length})  ← original stands`);
console.log(`actions             ${JSON.stringify(Object.fromEntries(["requery", "rewrite", "decline"].map((a) => [a, rec.filter((r) => r.action === a).length])))}`);
console.log(`\nfabrications on revised turns  ${sum(rev, (r) => r.fabsBefore)} → ${sum(rev, (r) => r.fabsAfter)}`);
console.log(`verdict transitions            ${rev.map((r) => `${r.overallBefore}→${r.overallAfter}`).join(", ") || "(none)"}`);
console.log(`harness token overhead         ${sum(ok, (r) => r.harnessTokens)} tokens over ${ok.length} turns (mean ${Math.round(sum(ok, (r) => r.harnessTokens) / Math.max(1, ok.length))}/turn)`);
console.log(`mean latency                   ${(sum(ok, (r) => r.latencyMs) / Math.max(1, ok.length) / 1000).toFixed(1)}s`);
console.log(`\nanswer pairs for ${rev.length} revised turns saved to ${REPORT_PATH} — judge quality deltas from there.`);
