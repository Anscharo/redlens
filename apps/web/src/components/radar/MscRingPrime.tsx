import { formatMonth, formatUsd } from "../../lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import type { RingPrime } from "../../lib/mscOverviewLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { markId, formatShare } from "./MscRingPills";

export interface MscRingPrime {
  flow: PrimeFlowTotals;
  ring: RingPrime;
  label: string;
  /** The prime's identity color — same fill as its timeseries layers. */
  bandColor: string;
  /** Router-relative settlements path; null when no radar actor matches the
   *  workbook prime (published before the atlas has the actor) — unlinked. */
  to: string | null;
}

/** One prime: a pie of its gross-revenue line items (a loss as a hole in
 *  the middle), its name outside, and its To-Sky arrow. */
export function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const arrow = ring.arrow;
  const share = arrow?.share != null ? formatShare(arrow.share) : null;
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      {arrow && (
        <g className="msc-ring-mark" data-mark={markId(flow.prime, arrow.kind)}>
          <path
            d={arrow.path}
            className={arrow.signed < 0 ? "msc-ring-arrow" : "msc-ring-arrow msc-ring-sky"}
            fill={arrow.signed < 0 ? `url(#msc-ring-neg-${arrow.kind})` : undefined}
          />
        </g>
      )}
      {/* Identity ring in the prime's color, just outside the slices. */}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r + 2} className="msc-ring-rim" style={{ stroke: bandColor }} />
      {ring.slices.map((s) => (
        <g key={s.kind} className="msc-ring-mark" data-mark={markId(flow.prime, s.kind)}>
          <path d={s.path} fillRule="evenodd" className={`msc-ring-slice msc-ring-${s.kind}`} />
        </g>
      ))}
      {/* The loss hole: striped in the kept color, the same mark the key
          uses for "supply loss". Its AREA is the loss. */}
      {ring.hole && (
        <g className="msc-ring-mark" data-mark={markId(flow.prime, "loss")}>
          <circle cx={ring.cx} cy={ring.cy} r={ring.hole.r} className="msc-ring-hole" fill="url(#msc-ring-neg-kept)" />
        </g>
      )}
      <g className="msc-ring-mark" data-mark={markId(flow.prime, "gross")}>
        <text x={ring.labelX} y={ring.labelY} textAnchor="middle" fontSize={17} className="msc-ring-label">
          {label}
        </text>
      </g>
    </g>
  );
  if (!to) return group;
  const shareText = share ? ` (${share} of its gross revenue)` : "";
  return (
    <SvgRouteLink
      to={to}
      label={`${label}, ${formatMonth(month)}: ${formatUsd(flow.sky, true)} to Sky${shareText} — ${formatUsd(flow.cof, true)} cost of funds, ${formatUsd(flow.sde, true)} Sky Direct Exposure; ${formatUsd(flow.kept, true)} supply kept, ${formatUsd(flow.demand, true)} demand-side. Open settlement page.`}
    >
      {group}
    </SvgRouteLink>
  );
}
