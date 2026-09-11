import { formatMonth, formatUsd, SETTLEMENT_NEAR_ZERO } from "../../lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import type { RingPrime } from "../../lib/mscOverviewLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { markId, formatShare, SLICE_CODE } from "./MscRingPills";

/** One Prime on the overview, as both charts see it. */
export interface OverviewPrime {
  flow: PrimeFlowTotals;
  label: string;
  /** The prime's identity color — same fill as its timeseries layers. */
  bandColor: string;
  /** Router-relative settlements path; null when no radar actor matches the
   *  workbook prime (published before the atlas has the actor) — unlinked. */
  to: string | null;
}

export interface MscRingPrime extends OverviewPrime {
  ring: RingPrime;
}

/** The link's accessible name — every figure, since the shapes have none. */
export function primeLinkLabel(flow: PrimeFlowTotals, label: string, month: string, share: number | null): string {
  const shareText = share != null ? ` (${formatShare(share)} of its gross revenue)` : "";
  return `${label}, ${formatMonth(month)}: ${formatUsd(flow.sky, true)} to Sky${shareText} — ${formatUsd(flow.cof, true)} cost of funds, ${formatUsd(flow.sde, true)} Sky Direct Exposure; ${formatUsd(flow.kept, true)} supply-side kept, ${formatUsd(flow.demand, true)} demand-side. Open settlement page.`;
}

/** One prime: a pie of its gross-revenue line items (a loss as a hole in
 *  the middle), its name outside, and its To-Sky arrow. */
export function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const arrow = ring.arrow;
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      {arrow && (
        <g className="msc-ring-mark" data-mark={markId(flow.prime, arrow.kind)}>
          {/* Which components the arrow actually carries, so the key's CoF
              and SDE rows light only the arrows with that money in them.
              From the signed figures, not the slices: a negative SDE has no
              slice but still rides the arrow. */}
          <path
            d={arrow.path}
            className={arrow.signed < 0 ? "msc-ring-arrow" : "msc-ring-arrow msc-ring-sky"}
            fill={arrow.signed < 0 ? "url(#msc-ring-loss)" : undefined}
            data-cof={Math.abs(arrow.cof) >= SETTLEMENT_NEAR_ZERO ? "true" : undefined}
            data-sde={Math.abs(arrow.sde) >= SETTLEMENT_NEAR_ZERO ? "true" : undefined}
          />
        </g>
      )}
      {/* Identity ring in the prime's color, just outside the slices — the
          one stroke that says whose pie this is; slices are separated by a
          card-colored gap (CSS), not by outlines. */}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r + 2.5} className="msc-ring-rim" style={{ stroke: bandColor }} />
      {ring.slices.map((s) => (
        <g key={s.kind} className="msc-ring-mark" data-mark={markId(flow.prime, s.kind)}>
          <path d={s.path} fillRule="evenodd" className={`msc-ring-slice msc-ring-${s.kind}`} />
        </g>
      ))}
      {/* In-slice figures, in the slice's own ink (data-kind → token). */}
      {ring.slices.map((s) =>
        s.figureX != null && s.figureY != null ? (
          <text key={`${s.kind}-fig`} x={s.figureX} y={s.figureY + 5} textAnchor="middle" fontSize={15} className="msc-ring-figure mono" data-kind={s.kind}>
            {SLICE_CODE[s.kind]} {formatUsd(s.signed, true)}
          </text>
        ) : null,
      )}
      {/* The loss hole: striped in the kept color, the same mark the key
          uses for "supply-side loss". Its AREA is the loss. */}
      {ring.hole && (
        <g className="msc-ring-mark" data-mark={markId(flow.prime, "loss")}>
          <circle cx={ring.cx} cy={ring.cy} r={ring.hole.r} className="msc-ring-hole" fill="url(#msc-ring-loss)" />
        </g>
      )}
      <g className="msc-ring-mark" data-mark={markId(flow.prime, "gross")}>
        <text x={ring.labelX} y={ring.labelY} textAnchor="middle" fontSize={24} className="msc-ring-label">
          {label}
        </text>
        {/* Gross revenue on the line under the name — the pie's area, in words. */}
        <text
          x={ring.labelX}
          y={ring.labelY + 20}
          textAnchor="middle"
          fontSize={16}
          className="msc-ring-sublabel mono"
        >
          {formatUsd(ring.gross, true)}
        </text>
      </g>
    </g>
  );
  if (!to) return group;
  return (
    <SvgRouteLink to={to} label={primeLinkLabel(flow, label, month, arrow?.share ?? null)}>
      {group}
    </SvgRouteLink>
  );
}
