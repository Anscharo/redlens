// The pill layer's vocabulary — mark ids, the per-series colour token, and
// the wording of a hover figure. Pure, so the phrasing is testable without
// rendering an svg (CLAUDE.md: report/data logic lives in src/lib).
import { DEMAND_SERIES, formatUsd } from "./settlements";

/** Marks and their pills live in different SVG layers (pills paint last, over
 *  everything), so they're paired by id rather than by nesting — see the
 *  generated `:has()` rules in MscRing. */
export const markId = (prime: string, kind: string): string => `${prime}::${kind}`;

/** "71%" — whole percent; a share over 100% is real (a Prime that owed Sky
 *  more than it made that month) and is shown as such. */
export const formatShare = (share: number): string => `${Math.round(share * 100)}%`;

export { SLICE_CODE } from "./mscOverviewLayout";

/** The series token each line item is drawn in — the ring's slice fills
 *  (index.css `.msc-ring-<kind>`), the key's swatches and the Prime page's
 *  demand-side bars all read the same one. */
export const SLICE_TOKEN: Record<string, string> = {
  cof: "--msc-sky",
  sde: "--msc-sde",
  kept: "--msc-kept",
  agentRate: "--msc-rate",
  distributionRewards: "--msc-dr",
  gar: "--msc-gar",
  chroniclePoints: "--msc-cp",
  /** The loss mark's color (always striped). */
  neg: "--msc-loss",
};

/** Human names for the pie's line items (the workbook Summary's rows). */
export const SLICE_LABEL: Record<string, string> = {
  cof: "cost of funds → Sky",
  sde: "Sky Direct Exposure → Sky",
  kept: "supply-side kept",
  ...Object.fromEntries(DEMAND_SERIES.map((s) => [s.key, `${s.label.toLowerCase()} (demand-side)`])),
};

/** Pill text names what it is, not just the number — a bare "$2.6M" says
 *  nothing about which flow it belongs to. */
export function pillText(kind: string, signed: number, primeLabel: string, share?: number | null): string {
  const amount = formatUsd(signed, true);
  if (kind === "sky") {
    return share != null
      ? `${amount} to Sky — ${formatShare(share)} of ${primeLabel}'s gross revenue*`
      : `${amount} to Sky`;
  }
  if (kind === "share") return `${amount} to Sky from ${primeLabel}`;
  if (kind === "gross") return `${amount} gross revenue* of ${primeLabel}`;
  // The orbit's pies are what each party RECEIVED, so its totals say so.
  if (kind === "received") return `${amount} received by ${primeLabel} — supply-side kept + demand-side`;
  if (kind === "demand") return `${amount} demand-side, from Sky to ${primeLabel}`;
  if (kind === "loss") return `${amount} supply-side loss`;
  if (kind in SLICE_LABEL) return `${amount} ${SLICE_LABEL[kind]}`;
  return `${amount} ${kind}`;
}
