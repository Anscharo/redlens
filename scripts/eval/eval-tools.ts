// Tool-choice eval — the A/B every system-prompt or tool-definition change must
// pass first (docs/chat-system.md §12). An earlier tool-description trim made
// the chat worse at picking tools and no eval noticed: eval:golden grades 8
// answers, eval:bakeoff 16, and neither builds the turn production builds.
// This one runs each case in eval-tools-cases.ts through prepareTurn (the
// route's own pre-first-token assembly) and runChat (the production loop) with
// real models, and scores which tool the model reached for FIRST.
//
//   pnpm eval:tools --label <name>        → .cache/eval-tools.<name>.json
//     --passes N          runs per case per arm (default 3)
//     --tiers a,b         arms: routed (production routing) and/or a forced
//                         tier chain fast|default|strong (default: routed,default,
//                         so the default model is measured on every case)
//     --only id,id        subset of cases
//     --concurrency N     parallel runs (default 4)
//     --timeout S         per-run wall budget (default 240)
//     --resume            keep finished runs from the label's file, run the rest
//     --no-dedupe         also re-run forced-default where the routed run already
//                         used the default chain (by default it is reused)
//     --dry-run           routing + facts per case, no chat model calls
//     --print             re-print an existing report, spend nothing
//     --rescore           re-grade an existing report's recorded calls with the
//                         current case labels, write it back, print it
//   pnpm eval:tools:compare <labelA> <labelB>   the A/B gate
//
// Needs OPENROUTER_API_KEY and built artifacts; DATABASE_URL for the history
// tools and semantic search (without it those degrade to tool errors, which
// this eval would count). PostHog is switched off for the process below.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { TOOL_CASES } from "./eval-tools-cases.ts";
import { scoreRun, validateCases, type ToolCase } from "./eval-tools-score.ts";
import { reportPath, type ToolEvalReport } from "./eval-tools-report.ts";
import type { Arm, RunRecord } from "./eval-tools-run.ts";

// Before any server module loads: posthog-node.ts reads POSTHOG_KEY at import
// and Bun auto-loads .env.local, so without this every eval generation would
// land in production's $ai_generation stream and skew chat_route_reason.
process.env.POSTHOG_KEY = "";
const { config } = await import("../../src/server/config.ts");
const { loadIndexes } = await import("../../src/server/retrieval/indexes.ts");
const { CHAT_TOOLS } = await import("../../src/server/chat/tools/llm-tools.ts");
const { atlasQueryShape } = await import("../../src/server/retrieval/query-schema.ts");
const { buildSystemPrompt } = await import("../../src/server/chat/system-prompt.ts");
const { resolveTierModels, iterationsForTier } = await import("../../src/server/chat/model-router.ts");
const { prepareTurn } = await import("../../src/server/chat/turn-setup.ts");
const { runCase, resolveCase } = await import("./eval-tools-run.ts");
const { printReport } = await import("./eval-tools-print.ts");

const argv = process.argv.slice(2);
const flag = (n: string) => argv.flatMap((a, i) => (a === `--${n}` && argv[i + 1] ? [argv[i + 1]] : []));
const LABEL = flag("label")[0] ?? "latest";
const PASSES = Number(flag("passes")[0] ?? 3);
const ARMS = [...new Set((flag("tiers")[0] ?? "routed,default").split(",").map((s) => s.trim()))].sort((a, b) => (a === "routed" ? -1 : b === "routed" ? 1 : 0)) as Arm[];
const ONLY = new Set(flag("only").flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean));
const CONCURRENCY = Math.max(1, Number(flag("concurrency")[0] ?? 4));
const TIMEOUT_MS = Number(flag("timeout")[0] ?? 240) * 1000;
const OUT = reportPath(LABEL);

const caseMeta = ({ id, category, acceptFirst, acceptFirstAfterDocFacts, acceptAny, forbid }: ToolCase) => ({ id, category, acceptFirst, acceptFirstAfterDocFacts, acceptAny, forbid });
if (argv.includes("--print") || argv.includes("--rescore")) {
  const rep = JSON.parse(fs.readFileSync(OUT, "utf8")) as ToolEvalReport;
  if (argv.includes("--rescore")) {
    // Scores are a pure function of the recorded calls, so a corrected label
    // re-grades a finished run for free. Both sides of a compare must be
    // rescored with the same labels (compare warns when they differ).
    const byId = new Map(TOOL_CASES.map((c) => [c.id, c]));
    rep.cases = rep.cases.map((m) => (byId.has(m.id) ? caseMeta(byId.get(m.id)!) : m));
    for (const r of rep.runs) if (byId.has(r.id)) r.score = scoreRun(byId.get(r.id)!, r.calls, r.facts);
    fs.writeFileSync(OUT, JSON.stringify(rep, null, 1));
  }
  printReport(rep);
  process.exit(0);
}
for (const a of ARMS) if (!["routed", "fast", "default", "strong"].includes(a)) throw new Error(`unknown arm ${a}`);
const problems = validateCases(TOOL_CASES, new Set(CHAT_TOOLS.flatMap((t) => (t.type === "function" ? [t.function.name] : []))), new Set(Object.keys(atlasQueryShape)));
if (problems.length) throw new Error(`bad cases:\n  ${problems.join("\n  ")}`);
if (!config.openrouterApiKey) throw new Error("OPENROUTER_API_KEY is not set (.env.local)");
const ix = loadIndexes();
const cases = ONLY.size ? TOOL_CASES.filter((c) => ONLY.has(c.id)) : TOOL_CASES;
if (cases.length === 0) throw new Error(`--only matched nothing`);

if (argv.includes("--dry-run")) {
  for (const c of cases) {
    const { q, pageContext } = resolveCase(ix, c);
    const t = await prepareTurn({ ix, message: q, history: [...(c.history ?? []), { role: "user", content: q }], pageContext });
    const jev = t.judgement ? `jev=${t.judgement.complexity?.toFixed(2)}` : "jev=missed";
    console.log(`${c.id.padEnd(26)} ${`${t.route.tier}/${t.route.reason}`.padEnd(20)} ${jev.padEnd(10)} facts=${t.facts?.used.map((u) => u.id).join(",") || "-"}`);
  }
  process.exit(0);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const prompt = (style: "inline" | "reference") => buildSystemPrompt(ix, undefined, style, "2000-01-01", config.chatMaxIterations);
const report: ToolEvalReport = {
  label: LABEL,
  ranAt: new Date().toISOString(),
  atlasCommit: ix.meta.atlasCommit ?? null,
  provenance: {
    toolsSha: sha(JSON.stringify(CHAT_TOOLS)),
    promptSha: sha(prompt("inline") + prompt("reference")),
    models: { fast: resolveTierModels("fast"), default: resolveTierModels("default"), strong: resolveTierModels("strong") },
    prefetchJudge: config.chatPrefetchJudgeModel,
    judgeDeadlineMs: config.chatPrefetchJudgeDeadlineMs,
  },
  passes: PASSES,
  arms: ARMS,
  cases: cases.map(caseMeta),
  runs: [],
};
const key = (id: string, arm: Arm, pass: number) => `${id}|${arm}|${pass}`;
const done = new Map<string, RunRecord>();
let carried: RunRecord[] = []; // errored runs of cases this invocation does not re-run
if (argv.includes("--resume") && fs.existsSync(OUT)) {
  const prior = JSON.parse(fs.readFileSync(OUT, "utf8")) as ToolEvalReport;
  if (prior.provenance.toolsSha !== report.provenance.toolsSha || prior.provenance.promptSha !== report.provenance.promptSha) {
    throw new Error(`--resume: ${OUT} was run against different tools/prompt — use a new --label`);
  }
  // Keep EVERY finished run, not just --only's: --only picks what to run now,
  // never what the file keeps. Case metadata merges the same way.
  for (const r of prior.runs) if (!r.error) done.set(key(r.id, r.arm, r.pass), r);
  carried = prior.runs.filter((r) => r.error && !cases.some((c) => c.id === r.id));
  const now = new Map(report.cases.map((m) => [m.id, m]));
  report.cases = [...prior.cases.map((m) => now.get(m.id) ?? m), ...report.cases.filter((m) => !prior.cases.some((p) => p.id === m.id))];
  report.passes = Math.max(prior.passes, PASSES);
  report.arms = [...new Set([...prior.arms, ...ARMS])];
  console.log(`resuming: keeping ${done.size} finished runs`);
}
const save = () => {
  report.runs = [...carried, ...done.values()];
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
};

// A routed run that landed on the default chain IS a forced-default run —
// same models, same prompt, same round budget — so it is reused rather than
// paid for twice, unless --no-dedupe.
const DEDUPE = !argv.includes("--no-dedupe");
const defaultChain = JSON.stringify(resolveTierModels("default"));
const isDefaultRun = (r: RunRecord) => !r.error && JSON.stringify(r.models) === defaultChain && r.maxIterations === iterationsForTier("default");

const items = Array.from({ length: PASSES }, (_, i) => cases.map((c) => ({ c, pass: i + 1 }))).flat();
const total = items.length * ARMS.length;
let finished = items.flatMap(({ c, pass }) => ARMS.map((a) => key(c.id, a, pass))).filter((k) => done.has(k)).length;
let cursor = 0;
async function worker() {
  for (let i = cursor++; i < items.length; i = cursor++) {
    const { c, pass } = items[i];
    for (const arm of ARMS) {
      if (done.has(key(c.id, arm, pass))) continue;
      const routed = done.get(key(c.id, "routed", pass));
      const rec = arm === "default" && DEDUPE && routed && isDefaultRun(routed)
        ? { ...routed, arm, reusedFrom: "routed" as const }
        : await runCase({ ix, c, arm, pass, timeoutMs: TIMEOUT_MS });
      done.set(key(c.id, arm, pass), rec);
      save();
      const s = rec.score;
      const verdict = rec.error ? `ERROR ${rec.error.slice(0, 50)}` : `${s?.firstOk ? "ok  " : "MISS"} ${s?.firstCalls.join("+") || "(none)"}`;
      console.log(`[${++finished}/${total}] ${c.id} ${arm}#${pass} ${rec.route.tier}/${rec.route.reason} → ${verdict}${rec.reusedFrom ? " (reused)" : ` ${(rec.latencyMs / 1000).toFixed(1)}s`}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
save();
printReport(report);
console.log(`\nwrote ${OUT}`);
process.exit(0);
