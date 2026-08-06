// Phase 0 A/B for the constraints-wiki commentary card (docs/research/constraints-wiki.md).
// Same end-to-end stack as eval-harness (runVerifiedChat, exactly as chat.ts drives it),
// two arms per query, paired within a worker so time-varying drift hits both arms equally:
//   base — buildSystemPrompt(ix) as shipped
//   wiki — same + scripts/aux/eval-corpora/wiki-card.md appended to the system prompt
// Deterministic metrics only (no judge model): retrieval rounds, tool messages,
// fabrications, verifier verdicts, escalations, latency, tokens. Final answers are
// saved to the report for manual quality judging.
//
//   pnpm eval:wiki-ab
//   pnpm eval:wiki-ab --only lawyer-registry --concurrency 2
import fs from "node:fs";
import path from "node:path";
import type OpenAI from "openai";
import { loadIndexes } from "../../src/server/retrieval/indexes.ts";
import { buildSystemPrompt } from "../../src/server/chat/system-prompt.ts";
import { runVerifiedChat, type CheckRowMeta } from "../../src/server/chat/chat-orchestrator.ts";
import { makeOpenrouterStream, openrouterJson } from "../../src/server/chat/llm.ts";
import { runDeterministicChecks } from "../../src/server/chat/verify/verify-checks.ts";
import { config } from "../../src/server/config.ts";
import { BAKEOFF_QUERIES, type BakeoffQuery } from "./eval-bakeoff-queries.ts";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Arm = "base" | "wiki";

const ROOT = path.resolve(import.meta.dir, "../..");
const argv = process.argv.slice(2);
const flag = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
const ONLY = new Set(flag("only"));
const CONCURRENCY = Number(flag("concurrency")[0] ?? 3);
const REPORT_PATH = path.join(ROOT, ".cache", "eval-wiki-ab.json");
const CARD = fs.readFileSync(path.join(import.meta.dir, "eval-corpora", "wiki-card.md"), "utf8");

// Queries chosen to differentiate the card's entries (W-refs in comments), plus four
// reused bakeoff queries that already probe scaffolding/abstention and template shape.
const WIKI_QUERIES: BakeoffQuery[] = [
  {
    id: "spark-root-edit", // W4
    query: "How can SPK holders change the Spark Agent Artifact? What are the thresholds and review periods?",
    expect:
      "≥1% of circulating supply to propose, 7-day Operational Facilitator alignment review, 3-day Snapshot poll with ≥10% participation and 50% in favor, plus Spark's parallel 7-day Risk Council review — cited from Spark's OWN docs. Quoting Sky Core weekly-cycle thresholds instead is a fail.",
  },
  {
    id: "december-cycle", // W4
    query: "Is there a monthly governance cycle in December? How does the AEP schedule handle it?",
    expect:
      "No Monthly Governance Cycle in December, cited. Good answers also surface the 7-day text freeze and the no-unamended-resubmission rule.",
  },
  {
    id: "emissions-entrenchment", // W5
    query: "Can Spark Governance re-enable token emissions beyond the Genesis Supply?",
    expect:
      "No — permanently disabled and not revertible by Spark Governance; the only override is Sky-held under Risk Capital violation. Cited.",
  },
  {
    id: "immutable-docs-change", // W3
    query: "Can Immutable Documents in the Atlas ever be changed?",
    expect:
      "Yes, through normal governance until the Endgame State is reached; only then do they become truly immutable. ≤3 layers deep. A flat 'never' is a fail.",
  },
  {
    id: "capital-ratio", // W7
    query: "What is the Capital Ratio required by the Atlas and where is it defined?",
    expect: "Exactly 8.75%, with the defining doc cited. Rounding or hedging the number is a fail.",
  },
  {
    id: "keel-rate-limit", // W7/W8
    query: "What is Keel's USDS minting rate limit?",
    expect:
      "The (maxAmount, slope) pair from Keel's own rate-limit doc, cited. Reusing another agent's limit or presenting the template value as Keel-specific without Keel's doc is a fail.",
  },
  {
    id: "lawyer-registry", // W9
    query: "Which approved legal counsels are listed in the Atlas Lawyer Registry?",
    expect:
      "None — the registry doc itself says there are no active legal counsels; a good answer cites that empty doc (grounded abstention). Inventing counsels is a hard fail.",
  },
  {
    id: "atlas-silence", // W11
    query: "What is a Facilitator supposed to do when the Atlas gives no explicit guidance for a situation?",
    expect:
      "Describes the atlas's own meta-rules: extrapolation from the Spirit of the Atlas, Chesterton's Fence, and (for Executor ambiguity) erring on the side of no changes / routing through Root Edit. Inventing a procedure is a fail.",
  },
  {
    id: "reviewer-pr", // W6
    query: "Can a Spell Reviewer contribute code to a spell through a pull request?",
    expect:
      "No — indirect contribution via PRs is separately and explicitly prohibited (distinct from the direct-commit ban). Cited.",
  },
  {
    id: "agent-customizations", // W8
    query: "Have any Prime Agents defined custom routine protocols beyond the Sky Core baseline?",
    expect:
      "No — the customization fence doc says '[No customization presently.]'; a good answer cites it rather than just failing to find customizations.",
  },
];
const REUSED_BAKEOFF = new Set(["rewards-paid", "integration-boost-vendors", "spell-history", "primitives-structure"]);
const ALL = [...BAKEOFF_QUERIES.filter((q) => REUSED_BAKEOFF.has(q.id)), ...WIKI_QUERIES];
const queries = ONLY.size ? ALL.filter((q) => ONLY.has(q.id)) : ALL;

if (!config.openrouterApiKey) {
  console.error("OPENROUTER_API_KEY is not set (.env.local).");
  process.exit(1);
}
const ix = loadIndexes();
const SYSTEM: Record<Arm, string> = {
  base: buildSystemPrompt(ix),
  wiki: `${buildSystemPrompt(ix)}\n\n${CARD}`,
};

interface Result {
  id: string;
  arm: Arm;
  toolRounds: number; // assistant messages that made tool calls
  toolMsgs: number; // tool-result messages in the transcript
  fabs: number; // deterministic fabrication count on the final answer
  overall: string | null; // verifier verdict
  overallRecheck: string | null;
  escalated: boolean;
  action: string | null;
  emptyAnswer: boolean;
  latencyMs: number;
  usage: { input: number; output: number };
  harnessTokens: number;
  finalAnswer: string;
  error: string | null;
}

async function runOne(q: BakeoffQuery, arm: Arm): Promise<Result> {
  const started = Date.now();
  const base: Result = {
    id: q.id, arm, toolRounds: 0, toolMsgs: 0, fabs: 0, overall: null, overallRecheck: null,
    escalated: false, action: null, emptyAnswer: false, latencyMs: 0,
    usage: { input: 0, output: 0 }, harnessTokens: 0, finalAnswer: "", error: null,
  };
  try {
    const messages: Msg[] = [
      { role: "system", content: SYSTEM[arm] },
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

    const t = done.transcript;
    const toolTexts = t.filter((m) => m.role === "tool" && typeof m.content === "string").map((m) => m.content as string);
    const c = runDeterministicChecks(done.content, toolTexts, ix);
    const meta = done.checksMeta ?? [];
    const advisorRow = meta.find((m) => m.kind === "advisor_recovery");
    const advVerdict = advisorRow?.verdict as { action?: string } | null | undefined;
    return {
      ...base,
      toolRounds: t.filter((m) => m.role === "assistant" && "tool_calls" in m && Array.isArray(m.tool_calls) && m.tool_calls.length > 0).length,
      toolMsgs: t.filter((m) => m.role === "tool").length,
      fabs: c.invalidCitations.length + c.invalidDocNos.length + c.docNoMismatches.length + c.ungroundedQuotes.length,
      overall: meta.find((m) => m.kind === "verify")?.overall ?? null,
      overallRecheck: meta.find((m) => m.kind === "verify_recheck")?.overall ?? null,
      escalated: Boolean(advisorRow),
      action: advVerdict?.action ?? null,
      emptyAnswer: !done.content.trim(),
      latencyMs: Date.now() - started,
      usage: done.usage,
      harnessTokens: meta
        .filter((m) => m.kind === "verify" || m.kind === "verify_recheck" || m.kind === "advisor_recovery")
        .reduce((s, m) => s + (m.inputTokens ?? 0) + (m.outputTokens ?? 0), 0),
      finalAnswer: done.content,
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
    cardChars: CARD.length,
    queries: Object.fromEntries(queries.map((q) => [q.id, { query: q.query, expect: q.expect }])),
    results,
  }, null, 2));
};

console.log(`wiki-card A/B — chat=${config.chatModel} verifier=${config.chatVerifierModel || "(none)"} advisor=${config.chatAdvisorModel || "(none)"}`);
console.log(`${queries.length} queries × 2 arms, card ≈ ${Math.round(CARD.length / 4)} tokens\n`);

let cursor = 0;
async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= queries.length) return;
    // Both arms of a query run back-to-back in the same worker: paired in time.
    for (const arm of ["base", "wiki"] as const) {
      const r = await runOne(queries[i], arm);
      results.push(r);
      save();
      const tag = r.error
        ? `ERROR ${r.error.slice(0, 40)}`
        : `rounds=${r.toolRounds} tools=${r.toolMsgs} fabs=${r.fabs} overall=${r.overall ?? "—"}${r.escalated ? ` ESC→${r.action ?? "none"}` : ""} ${(r.latencyMs / 1000).toFixed(0)}s`;
      console.log(`[${results.length}/${queries.length * 2}] ${queries[i].id.padEnd(26)} ${arm.padEnd(4)} ${tag}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));

// ── Summary ────────────────────────────────────────────────────────────────
const byArm = (arm: Arm) => results.filter((r) => r.arm === arm && !r.error);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const dist = (rs: Result[]) => {
  const acc: Record<string, number> = {};
  for (const r of rs) acc[r.overall ?? "none"] = (acc[r.overall ?? "none"] ?? 0) + 1;
  return JSON.stringify(acc);
};
console.log(`\n── per-query paired (base → wiki) ──`);
for (const q of queries) {
  const a = results.find((r) => r.id === q.id && r.arm === "base");
  const b = results.find((r) => r.id === q.id && r.arm === "wiki");
  if (!a || !b) continue;
  const cell = (r: Result) => (r.error ? "ERR" : `r${r.toolRounds} f${r.fabs} ${r.overall ?? "—"} ${(r.latencyMs / 1000).toFixed(0)}s`);
  console.log(`  ${q.id.padEnd(26)} ${cell(a).padEnd(24)} → ${cell(b)}`);
}
for (const arm of ["base", "wiki"] as const) {
  const rs = byArm(arm);
  console.log(`\n── ${arm} (${rs.length} ok of ${results.filter((r) => r.arm === arm).length}) ──`);
  console.log(`  rounds mean        ${mean(rs.map((r) => r.toolRounds)).toFixed(2)}   tool msgs mean ${mean(rs.map((r) => r.toolMsgs)).toFixed(2)}`);
  console.log(`  fabrications total ${rs.reduce((s, r) => s + r.fabs, 0)}`);
  console.log(`  verdicts           ${dist(rs)}`);
  console.log(`  escalations        ${rs.filter((r) => r.escalated).length}   empty answers ${rs.filter((r) => r.emptyAnswer).length}`);
  console.log(`  latency mean       ${(mean(rs.map((r) => r.latencyMs)) / 1000).toFixed(1)}s`);
  console.log(`  tokens mean        in ${Math.round(mean(rs.map((r) => r.usage.input)))} out ${Math.round(mean(rs.map((r) => r.usage.output)))} harness ${Math.round(mean(rs.map((r) => r.harnessTokens)))}`);
}
console.log(`\nanswers saved to ${REPORT_PATH} — judge answer-quality deltas from there.`);
