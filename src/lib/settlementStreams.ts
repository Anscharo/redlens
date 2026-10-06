// One Prime's settlement month as directed streams: where its supply-side
// revenue is earned (per venue), what of it goes to Sky as cost of funds,
// what stays with the Prime, what passes straight through to Sky as Sky
// Direct Exposure, and what Sky pays back on the demand side.
//
// The per-venue split rests on two identities the workbooks hold on every
// row (checked against all 48 published workbooks):
//   cof to Sky = profitToSky − sdRevenue       (= cofAlloc − spreadReimb)
//   kept       = revenueToPrime − cof to Sky
// Revenue with no venue row (Spark's PSM3) becomes a "prime-level" row, so
// Σ kept = primeAgentRevenue − cof = supplyKept() and Σ cof + Σ sde =
// skyRevenue — the streams foot to the headline card by construction (see
// settlement-reports skill, invariants 1 and 2).
import {
  DEMAND_SERIES,
  SETTLEMENT_NEAR_ZERO,
  demandPart,
  type DemandKey,
  type SettlementReport,
  type SettlementVenue,
} from "./settlements";

export const PRIME_LEVEL_ID = "_prime_level";
export const OTHER_ID = "_other";
/** Venues drawn individually; the rest fold into one "Other" row. */
export const STREAM_TOP_N = 12;

export interface VenueStream {
  id: string;
  label: string;
  synthetic: boolean;
  /** Gross supply-side revenue the venue earned for the Prime. */
  revenue: number;
  /** Its Sky Direct Exposure revenue — Sky's, passing through. */
  sde: number;
  /** Its share of the cost of funds owed to Sky. */
  cof: number;
  /** revenue − cof: what of this venue's revenue the Prime keeps. */
  kept: number;
}

export interface DemandStream {
  key: DemandKey;
  label: string;
  value: number;
}

export interface StreamModel {
  venues: VenueStream[];
  /** primeAgentRevenue — every venue's revenue plus the prime-level row. */
  revenue: number;
  cof: number;
  sde: number;
  /** cof + sde: the amount due from the Prime to Sky (A.2.4.1.2.2.1.1.2). */
  toSky: number;
  /** revenue − cof. */
  kept: number;
  /** Everything Sky pays the Prime, by series. */
  demand: DemandStream[];
  demandTotal: number;
  /** The part that is the Stage 1 amount due from Sky: agent rate and
   *  distribution rewards (A.2.4.1.2.2.1.1.1.3). */
  demandMsc: number;
}

const near = (v: number) => Math.abs(v) < SETTLEMENT_NEAR_ZERO;

export function venueStream(v: SettlementVenue): VenueStream {
  const sde = v.sdRevenue ?? 0;
  const cof = v.profitToSky - sde;
  return { id: v.id, label: v.label || v.id, synthetic: v.synthetic, revenue: v.revenueToPrime, sde, cof, kept: v.revenueToPrime - cof };
}

const weight = (s: VenueStream) => Math.abs(s.revenue) + Math.abs(s.sde) + Math.abs(s.cof);

function fold(tail: VenueStream[]): VenueStream {
  const sum = (k: "revenue" | "sde" | "cof" | "kept") => tail.reduce((n, s) => n + s[k], 0);
  return { id: OTHER_ID, label: `Other venues (${tail.length})`, synthetic: false, revenue: sum("revenue"), sde: sum("sde"), cof: sum("cof"), kept: sum("kept") };
}

/** Largest first; anything all-zero dropped; past `topN`, one Other row.
 *  A venue with Sky Direct Exposure is never folded: SDE goes to Sky
 *  without becoming the Prime's revenue, so it keeps its own name. */
export function collapseStreams(rows: readonly VenueStream[], topN = STREAM_TOP_N): VenueStream[] {
  const ranked = rows.filter((s) => !near(weight(s))).sort((a, b) => weight(b) - weight(a));
  if (ranked.length <= topN) return ranked;
  const rest = ranked.slice(topN);
  const tail = rest.filter((s) => near(s.sde));
  return [...ranked.slice(0, topN), ...rest.filter((s) => !near(s.sde)), ...(tail.length ? [fold(tail)] : [])];
}

export function streamModel(report: SettlementReport, topN = STREAM_TOP_N): StreamModel {
  const h = report.headline;
  const rows = report.venues.map(venueStream);
  const unattributed = h.primeAgentRevenue - rows.reduce((n, s) => n + s.revenue, 0);
  const venues = collapseStreams(rows, topN);
  if (!near(unattributed)) {
    venues.push({ id: PRIME_LEVEL_ID, label: "Prime-level (no venue)", synthetic: true, revenue: unattributed, sde: 0, cof: 0, kept: unattributed });
  }
  const demand = DEMAND_SERIES.map((s) => ({ key: s.key, label: s.label, value: demandPart(h, s.key) })).filter((d) => !near(d.value));
  return {
    venues,
    revenue: h.primeAgentRevenue,
    cof: h.cof,
    sde: h.sdeRevenue,
    toSky: h.skyRevenue,
    kept: h.primeAgentRevenue - h.cof,
    demand,
    demandTotal: demand.reduce((n, d) => n + d.value, 0),
    demandMsc: demand.filter((d) => DEMAND_SERIES.find((s) => s.key === d.key)!.msc).reduce((n, d) => n + d.value, 0),
  };
}

/** Anything to draw at all — a demand-only Prime (no venues, nothing owed
 *  to Sky) still has its demand lane. */
export function hasStreams(m: StreamModel): boolean {
  return m.venues.length > 0 || !near(m.toSky) || !near(m.demandTotal);
}
