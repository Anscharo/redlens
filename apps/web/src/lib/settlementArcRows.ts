// The rows the settlement rainbow draws on its outer lane: each venue's
// revenue to the Prime, and each venue's Sky Direct Exposure, which goes
// to Sky without becoming the Prime's revenue. Cost of funds is not a
// venue row: it is the Prime's own charge on the USDS it borrowed
// (A.3.1.2.5), and the workbook's per-venue split of it is pro rata.
import type { StreamModel } from "@/lib/settlementStreams";

/** Revenue venues drawn one by one; the rest fold into one Other band. */
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
  value: number;
}

function pick(m: StreamModel, k: "revenue" | "sde", n: number): ArcFlow[] {
  const suffix = k === "sde" ? "::sde" : "";
  const rows = m.venues
    .map((v) => ({ key: v.id + suffix, venue: v.id, label: v.label, value: v[k] }))
    .filter((v) => Math.abs(v.value) >= NEAR)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  if (rows.length <= n + 1) return rows;
  const value = rows.slice(n).reduce((s, v) => s + v.value, 0);
  return [...rows.slice(0, n), { key: ARC_OTHER_ID + suffix, venue: ARC_OTHER_ID, label: "Other venues", value }];
}

/** Largest first, each list folding its tail into Other. */
export function arcSources(m: StreamModel): { revenue: ArcFlow[]; sde: ArcFlow[] } {
  return { revenue: pick(m, "revenue", ARC_TOP_N), sde: pick(m, "sde", SDE_TOP_N) };
}
