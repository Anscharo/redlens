// The tool-choice A/B gate: pnpm eval:tools:compare <labelA> <labelB>
// (labels of two `pnpm eval:tools` runs, or paths to their JSON). Run A on the
// current prompt/tools, B on the change, same passes and arms.
//
// Significance is an exact sign test (McNemar, exact form) over paired runs:
// run k of case X on arm Y in A against run k of the same case/arm in B; only
// pairs that disagree carry information. Within-label instability — a case
// whose own passes disagree — is printed next to it as the run-to-run noise
// floor. Exits 1 when B is significantly worse (p < 0.05) on any shared arm.
import { armTotals, caseRows, loadReport, pct, printTable, scored, type ToolEvalReport } from "./eval-tools-report.ts";
import { signTestP } from "./eval-tools-score.ts";
import type { Arm } from "./eval-tools-run.ts";

const [labelA, labelB] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!labelA || !labelB) {
  console.error("usage: pnpm eval:tools:compare <labelA> <labelB>");
  process.exit(2);
}
const A = loadReport(labelA);
const B = loadReport(labelB);
const arms = A.arms.filter((a) => B.arms.includes(a));
const ids = A.cases.map((c) => c.id).filter((id) => B.cases.some((c) => c.id === id));

console.log(`A=${A.label} (tools ${A.provenance.toolsSha}, prompt ${A.provenance.promptSha}, atlas ${(A.atlasCommit ?? "?").slice(0, 8)})`);
console.log(`B=${B.label} (tools ${B.provenance.toolsSha}, prompt ${B.provenance.promptSha}, atlas ${(B.atlasCommit ?? "?").slice(0, 8)})`);
if (A.atlasCommit !== B.atlasCommit) console.log("WARNING: different atlas commits — tool results differ, not only the prompt.");
if (JSON.stringify(A.provenance.models) !== JSON.stringify(B.provenance.models)) console.log("WARNING: different model chains.");
console.log(`shared: ${ids.length} cases × arms ${arms.join(",")}`);
const relabeled = ids.filter((id) => JSON.stringify(A.cases.find((c) => c.id === id)) !== JSON.stringify(B.cases.find((c) => c.id === id)));
if (relabeled.length) console.log(`WARNING: labels differ for ${relabeled.join(", ")} — run \`pnpm eval:tools --label <x> --rescore\` on both first.`);

// Cases whose own passes disagree — the noise floor, per label.
const unstable = (rep: ToolEvalReport, arm: Arm) =>
  caseRows(rep).filter((r) => r.arm === arm && ids.includes(r.id) && r.first > 0 && r.first < r.n).length;

let worse = false;
for (const arm of arms) {
  const run = (rep: ToolEvalReport, id: string, pass: number) => scored(rep.runs).find((r) => r.arm === arm && r.id === id && r.pass === pass);
  let b = 0; // A pass, B fail
  let c = 0; // A fail, B pass
  let pairs = 0;
  for (const id of ids) {
    for (let pass = 1; pass <= Math.min(A.passes, B.passes); pass++) {
      const ra = run(A, id, pass);
      const rb = run(B, id, pass);
      if (!ra || !rb) continue;
      pairs++;
      if (ra.score!.firstOk && !rb.score!.firstOk) b++;
      if (!ra.score!.firstOk && rb.score!.firstOk) c++;
    }
  }
  const p = signTestP(b, c);
  const ta = armTotals(A, arm);
  const tb = armTotals(B, arm);
  console.log(`\n## arm ${arm}: first-call ${pct(ta.firstRate)} → ${pct(tb.firstRate)}, all ${pct(ta.allRate)} → ${pct(tb.allRate)} over ${pairs} paired runs`);
  console.log(`   discordant pairs: ${b} worse, ${c} better → sign test p=${p.toFixed(3)} ${p < 0.05 ? (b > c ? "— B is WORSE beyond run-to-run noise" : "— B is better beyond run-to-run noise") : "— within run-to-run noise"}`);
  console.log(`   unstable cases (passes disagree within a label): A ${unstable(A, arm)}, B ${unstable(B, arm)}`);
  if (p < 0.05 && b > c) worse = true;

  const d = (x: number, y: number, digits = 2) => `${x.toFixed(digits)} → ${y.toFixed(digits)} (${y - x >= 0 ? "+" : ""}${(y - x).toFixed(digits)})`;
  printTable(
    [
      { metric: "requests / run", delta: d(ta.meanRequests, tb.meanRequests) },
      { metric: "tool calls / run", delta: d(ta.meanCalls, tb.meanCalls) },
      { metric: "tool errors / call", delta: `${pct(ta.callErrorRate)} → ${pct(tb.callErrorRate)}` },
      { metric: "empty results / call", delta: `${pct(ta.emptyRate)} → ${pct(tb.emptyRate)}` },
      { metric: "runs calling a forbidden tool", delta: `${ta.forbidden} → ${tb.forbidden}` },
      { metric: "atlas_query calls", delta: `${ta.aqCalls} → ${tb.aqCalls}` },
      { metric: "aq with filtering extra params", delta: `${pct(ta.aqEffectiveRate)} → ${pct(tb.aqEffectiveRate)}` },
      { metric: "aq with any extra params", delta: `${pct(ta.aqPresentRate)} → ${pct(tb.aqPresentRate)}` },
      { metric: "aq emptied by own filters", delta: `${ta.emptyByFilters} → ${tb.emptyByFilters}` },
      { metric: "latency s / run", delta: d(ta.meanLatencyS, tb.meanLatencyS, 1) },
    ],
    ["metric", "delta"],
  );

  // Flips: a case whose first-call pass count moved by at least one run of N.
  const rowsA = caseRows(A).filter((r) => r.arm === arm);
  const rowsB = caseRows(B).filter((r) => r.arm === arm);
  const flips = ids
    .map((id) => ({ a: rowsA.find((r) => r.id === id)!, b: rowsB.find((r) => r.id === id)! }))
    .filter(({ a, b }) => a.n && b.n && Math.abs(a.first / a.n - b.first / b.n) >= 1 / Math.max(a.n, b.n) - 1e-9)
    .sort((x, y) => x.b.first / x.b.n - x.a.first / x.a.n - (y.b.first / y.b.n - y.a.first / y.a.n));
  if (flips.length === 0) console.log("   no per-case flips");
  for (const { a, b } of flips) {
    const calls = (r: typeof a) => Object.entries(r.firstCalls).map(([k, v]) => `${k}×${v}`).join(", ");
    console.log(`   ${b.first / b.n < a.first / a.n ? "▼" : "▲"} ${a.id}: ${a.first}/${a.n} → ${b.first}/${b.n}   [A: ${calls(a)}] [B: ${calls(b)}]`);
  }
}
process.exit(worse ? 1 : 0);
