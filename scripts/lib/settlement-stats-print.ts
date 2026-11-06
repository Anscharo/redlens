// Console report for `pnpm settlements:parse`: coverage, per-venue counts and
// the reconcile() deltas. Reads the parsed bundle and writes nothing.
import type { SettlementReport } from "../../src/lib/settlements.ts";
import { reconcile } from "./settlement-xlsx.mjs";

type Report = SettlementReport;
interface Bundle { reports: Report[] }

/** A reconcile delta above this many dollars is flagged. */
export const THRESHOLD = 1;

function usd(n: number) {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


export function printStats(bundle: Bundle) {
  const { reports } = bundle;
  const primes = [...new Set(reports.map((r) => r.prime))];
  const months = [...new Set(reports.map((r) => r.month))].sort();
  console.log(`reports: ${reports.length}`);
  console.log(`primes:  ${primes.join(", ")}`);
  console.log(`months:  ${months[0] ?? "—"} … ${months[months.length - 1] ?? "—"} (${months.length})`);
  console.log("");
  console.log("venues (PnL rows, synthetic included):");
  for (const p of primes) {
    const rs = reports.filter((r) => r.prime === p);
    const counts = rs.map((r) => r.venues.length);
    const synth = rs.reduce((n, r) => n + r.venues.filter((v) => v.synthetic).length, 0);
    console.log(
      `  ${p.padEnd(10)} months=${String(rs.length).padStart(2)}  ` +
        `venues/month ${Math.min(...counts)}–${Math.max(...counts)}  synthetic=${synth}`,
    );
  }
  printReconciliation(reports);
  printUnfooted(reports);
  printSparkTop(reports);
}

function printReconciliation(reports: Report[]) {
  console.log("");
  console.log(
    `reconciliation (dCof is the load-bearing one; flag > ${usd(THRESHOLD)}):`,
  );
  let flags = 0;
  for (const r of reports) {
    const rec = reconcile(r);
    const bad = rec.dSky > THRESHOLD || rec.dP2G > THRESHOLD || rec.dCof > THRESHOLD;
    if (bad) flags++;
    const mark = bad ? "  FLAG" : "";
    const gap =
      rec.dRevenue > THRESHOLD ? `  revenueGap=${usd(rec.dRevenue)}` : "";
    console.log(
      `  ${r.prime}/${r.month}  dSky=${usd(rec.dSky)}  dP2G=${usd(rec.dP2G)}` +
        `  dCof=${usd(rec.dCof)}  venues=${r.venues.length}${gap}${mark}`,
    );
  }
  console.log(`flags: ${flags} / ${reports.length}`);
  console.log("(dCof = |Σ CoF alloc − Σ Spread Reimb − headline CoF|; catches a renamed CoF label,");
  console.log(" which parses as 0 and is otherwise indistinguishable from Keel/Skybase's real 0)");
  console.log("(revenueGap = |Σ venue.revenueToPrime − primeAgentRevenue|; Spark's is the non-venue PSM3 slice)");
}

function printUnfooted(reports: Report[]) {
  const unfooted = reports
    .map((r) => ({ r, rec: reconcile(r) }))
    .filter(({ rec }) => rec.dComparisonFoot > THRESHOLD);
  console.log("");
  console.log(
    `upstream Comparison blocks that do not foot: ${unfooted.length} / ${reports.length}`,
  );
  for (const { r, rec } of unfooted) {
    console.log(
      `  ${r.prime}/${r.month}  supplyKept(par−CoF)=${usd(rec.supplyKept)}` +
        `  ΣP2G=${usd(rec.sumProfitToGrove)}  off by ${usd(rec.dComparisonFoot)}`,
    );
  }
  console.log("(build_settlement_xlsx.py totals that block with Σ Profit to Grove rather than its");
  console.log(" own addends. We report supplyKept = prime_agent_revenue − CoF, per load/summary.py.)");
}

function printSparkTop(reports: Report[]) {
  const sparkJul = reports.find((r) => r.prime === "spark" && r.month === "2026-07");
  if (sparkJul) {
    const top = [...sparkJul.venues]
      .sort((a, b) => Math.abs(b.profitToSky) - Math.abs(a.profitToSky))
      .slice(0, 8);
    console.log("");
    console.log("spark/2026-07 top |Profit to Sky|:");
    for (const v of top) {
      console.log(`  ${v.id.padEnd(18)} ${usd(v.profitToSky).padStart(16)}  ${v.label}`);
    }
  }
}
