// The rows the settlement circle draws on its outer lane. Each venue row
// carries its revenue to the Prime and its cost of funds to Sky: the
// Atlas charges cost of funds venue by venue, as Instance Expense
// (A.2.4.1.2.2.1.1.2.2.1.1), and the workbook allocates it the same way.
// Sky Direct Exposure rows are apart: SDE yield is Sky's outright and
// never becomes the Prime's revenue (A.2.2.10.1.1.1.1.5).
import type { StreamModel } from "@/lib/settlementStreams";

/** Venues drawn one by one; the rest fold into one Other band. */
export const ARC_TOP_N = 5;
/** SDE venues drawn one by one; few Primes have more than two. */
export const SDE_TOP_N = 3;
export const ARC_OTHER_ID = "_arc_other";
/** Figures under half a dollar draw nothing. */
export const NEAR = 0.5;

export interface ArcFlow {
  /** Unique per band: the venue id, plus "::sde" on an SDE band. */
  key: string;
  /** The venue the band belongs to, for its colour and hover. */
  venue: string;
  label: string;
  /** Revenue to the Prime, or SDE on an SDE row. */
  value: number;
  /** The venue's cost of funds to Sky; 0 on an SDE row. */
  cof: number;
}

const big = (v: ArcFlow) => Math.max(Math.abs(v.value), Math.abs(v.cof));

function fold(rows: ArcFlow[], n: number, suffix: string): ArcFlow[] {
  if (rows.length <= n + 1) return rows;
  const sum = (k: "value" | "cof") => rows.slice(n).reduce((s, v) => s + v[k], 0);
  return [...rows.slice(0, n), { key: ARC_OTHER_ID + suffix, venue: ARC_OTHER_ID, label: "Other venues", value: sum("value"), cof: sum("cof") }];
}

/** Largest first, each list folding its tail into Other. A venue with cost
 *  of funds but no revenue (idle funds) is a row too: its cost still goes
 *  to Sky. */
export function arcSources(m: StreamModel): { revenue: ArcFlow[]; sde: ArcFlow[] } {
  const venues = m.venues
    .map((v) => ({ key: v.id, venue: v.id, label: v.label, value: v.revenue, cof: v.cof }))
    .filter((v) => big(v) >= NEAR)
    .sort((a, b) => big(b) - big(a));
  const sde = m.venues
    .map((v) => ({ key: `${v.id}::sde`, venue: v.id, label: v.label, value: v.sde, cof: 0 }))
    .filter((v) => Math.abs(v.value) >= NEAR)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return { revenue: fold(venues, ARC_TOP_N, ""), sde: fold(sde, SDE_TOP_N, "::sde") };
}
