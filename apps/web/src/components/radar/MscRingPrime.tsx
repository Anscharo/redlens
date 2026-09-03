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

/** One prime: a circular plate holding a floating stacked bar (gains up
 *  from the zero line, losses down from it, striped) with its name to the
 *  left of the zero line, and its To-Sky arrow with the share badge. */
export function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const arrow = ring.arrow;
  const share = arrow?.share != null ? formatShare(arrow.share) : null;
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      {/* Plate: one circle enclosing the bar and its name, tinted in the
          prime's identity color — the click/hover target for the prime. */}
      <circle
        cx={ring.plateX}
        cy={ring.plateY}
        r={ring.plateR}
        className="msc-ring-plate"
        style={{ fill: bandColor, stroke: bandColor }}
      />
      {arrow && (
        <g className="msc-ring-mark" data-mark={markId(flow.prime, arrow.kind)}>
          <path
            d={arrow.path}
            className={arrow.signed < 0 ? "msc-ring-arrow" : "msc-ring-arrow msc-ring-sky"}
            fill={arrow.signed < 0 ? `url(#msc-ring-neg-${arrow.kind})` : undefined}
          />
        </g>
      )}
      {/* Zero line in the prime's identity color — the bar's own axis. */}
      <line
        x1={ring.zeroX0}
        x2={ring.zeroX1}
        y1={ring.zeroY}
        y2={ring.zeroY}
        className="msc-ring-zero"
        style={{ stroke: bandColor }}
      />
      {ring.segments.map((s) => (
        <g key={s.kind} className="msc-ring-mark" data-mark={markId(flow.prime, s.kind)}>
          <rect
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            className={s.signed < 0 ? "msc-ring-seg" : `msc-ring-seg msc-ring-${s.kind}`}
            fill={s.signed < 0 ? `url(#msc-ring-neg-${s.kind})` : undefined}
          />
        </g>
      ))}
      {arrow && share && (
        <g className="msc-ring-share" aria-hidden="true">
          <rect x={arrow.labelX - 62} y={arrow.labelY - 9} width={124} height={18} rx={9} />
          <text x={arrow.labelX} y={arrow.labelY + 4} textAnchor="middle" fontSize={11} className="mono">
            {share} of production*
          </text>
        </g>
      )}
      <text x={ring.labelX} y={ring.labelY + 4} textAnchor="end" fontSize={13} className="msc-ring-label">
        {label}
      </text>
    </g>
  );
  if (!to) return group;
  const shareText = share ? ` (${share} of its production)` : "";
  return (
    <SvgRouteLink
      to={to}
      label={`${label}, ${formatMonth(month)}: ${formatUsd(flow.sky, true)} to Sky${shareText}, ${formatUsd(flow.kept, true)} supply kept, ${formatUsd(flow.demand, true)} demand-side. Open settlement page.`}
    >
      {group}
    </SvgRouteLink>
  );
}
