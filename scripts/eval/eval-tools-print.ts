// Console output for one tool-choice eval report (eval-tools.ts). Pure over
// the report file, so `pnpm eval:tools --label x --print` can re-render a
// finished run without spending anything.
import { aqByServedModel, armTotals, caseRows, pct, printTable, type ToolEvalReport } from "./eval-tools-report.ts";

const top = (counts: Record<string, number>, n = 3) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}×${v}`).join(", ");

export function printReport(rep: ToolEvalReport): void {
  const p = rep.provenance;
  console.log(`\n# eval:tools  label=${rep.label}  atlas=${(rep.atlasCommit ?? "?").slice(0, 8)}  passes=${rep.passes}  arms=${rep.arms.join(",")}`);
  console.log(`  tools=${p.toolsSha}  prompt=${p.promptSha}  prefetch-judge=${p.prefetchJudge || "(off)"} @${p.judgeDeadlineMs}ms`);
  for (const [tier, chain] of Object.entries(p.models)) console.log(`  ${tier}: ${chain.join(" → ")}`);

  // Per case: first-call pass count per arm, the full-turn pass count, and what
  // the first arm actually called first.
  const rows = caseRows(rep);
  const byCase = rep.cases.map((c) => {
    const out: Record<string, unknown> = { case: c.id, cat: c.category };
    for (const arm of rep.arms) {
      const r = rows.find((x) => x.id === c.id && x.arm === arm)!;
      out[`${arm}:first`] = r.n ? `${r.first}/${r.n}` : "-";
      out[`${arm}:all`] = r.n ? `${r.all}/${r.n}` : "-";
    }
    out.called_first = top(rows.find((x) => x.id === c.id && x.arm === rep.arms[0])?.firstCalls ?? {});
    return out;
  });
  console.log("\nper case (k/n runs whose first call was acceptable; all = first ok + acceptAny + nothing forbidden):");
  printTable(byCase, ["case", "cat", ...rep.arms.flatMap((a) => [`${a}:first`, `${a}:all`]), "called_first"]);

  const totals = rep.arms.map((a) => armTotals(rep, a));
  console.log("\ntotals per arm:");
  printTable(
    totals.map((t) => ({
      arm: t.arm, scored: `${t.n}/${t.runs}`, first: pct(t.firstRate), all: pct(t.allRate), requests: t.meanRequests.toFixed(2),
      calls: t.meanCalls.toFixed(2), call_err: pct(t.callErrorRate), empty: pct(t.emptyRate), forbidden: t.forbidden,
      routed_strong: t.routedStrong, fallback: t.fallbackServed, jev_missed: t.jevMissed, latency_s: t.meanLatencyS.toFixed(1),
    })),
    ["arm", "scored", "first", "all", "requests", "calls", "call_err", "empty", "forbidden", "routed_strong", "fallback", "jev_missed", "latency_s"],
  );

  console.log("\natlas_query parameters outside each case's allowance (base allowance: query, q, k, enrich):");
  printTable(
    totals.map((t) => ({ arm: t.arm, aq_calls: t.aqCalls, filtering_extra: pct(t.aqEffectiveRate), any_extra: pct(t.aqPresentRate), emptied_by_filters: t.emptyByFilters, params: top(t.aqParams, 8) || "-" })),
    ["arm", "aq_calls", "filtering_extra", "any_extra", "emptied_by_filters", "params"],
  );
  console.log("\n…by the model that actually served the run:");
  printTable(
    rep.arms.flatMap((arm) => aqByServedModel(rep, arm).map((m) => ({
      arm, served_by: m.model, runs: m.runs, aq_calls: m.aqCalls, filtering_extra: pct(m.effectiveRate), any_extra: pct(m.presentRate),
      emptied_by_filters: m.emptiedByFilters, params: top(m.params, 8) || "-",
    }))),
    ["arm", "served_by", "runs", "aq_calls", "filtering_extra", "any_extra", "emptied_by_filters", "params"],
  );

  console.log("\nfailing cases (first call not acceptable in ≥1 run):");
  for (const r of rows.filter((x) => x.n > 0 && x.first < x.n).sort((a, b) => a.first / a.n - b.first / b.n)) {
    const c = rep.cases.find((x) => x.id === r.id)!;
    const want = (c.acceptFirst.length ? c.acceptFirst.join("|") : "(no tool)") +
      (c.acceptFirstAfterDocFacts?.length ? ` (+${c.acceptFirstAfterDocFacts.join("|")} after a doc fact)` : "");
    console.log(`  ${r.id} [${r.arm}] ${r.first}/${r.n} — called first: ${top(r.firstCalls, 4)}; accepts: ${want}`);
  }
  const forbidden = rep.runs.filter((r) => r.score?.forbiddenCalled.length);
  for (const r of forbidden) console.log(`  ${r.id} [${r.arm} #${r.pass}] called forbidden ${r.score!.forbiddenCalled.join(", ")}`);
  const errors = rep.runs.filter((r) => r.error);
  if (errors.length) console.log(`\nerrored runs (not scored): ${errors.map((r) => `${r.id}[${r.arm}#${r.pass}]: ${r.error!.slice(0, 60)}`).join("; ")}`);

  const chat = totals.reduce((s, t) => s + t.costUsd, 0);
  const jev = totals.reduce((s, t) => s + t.jevCostUsd, 0);
  const sub = totals.reduce((s, t) => s + t.subagentTokens, 0);
  console.log(`\nspend: chat $${chat.toFixed(3)} + Jev $${jev.toFixed(4)} (OpenRouter-reported) + MSC helper ${sub} tokens (unpriced)`);
}
