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

/** One prime: a circular plate (area ∝ gross revenue) holding a floating
 *  stacked bar (gains up from the zero line, losses down from it, striped)
 *  with its name to the left of the zero line, and its To-Sky arrow. */
export function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const arrow = ring.arrow;
  const share = arrow?.share != null ? formatShare(arrow.share) : null;
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      {/* Plate: one circle enclosing the bar and its name, tinted in the
          prime's identity color; its AREA is the prime's gross revenue. */}
      <g className="msc-ring-mark" data-mark={markId(flow.prime, "gross")}>
        <circle
          cx={ring.plateX}
          cy={ring.plateY}
          r={ring.plateR}
          className="msc-ring-plate"
          style={{ fill: bandColor, stroke: bandColor }}
        />
      </g>
      {/* The To-Sky arrow, one band per component: cost of funds (blue) and
          Sky Direct Exposure (cyan), each its own hover mark. */}
      {arrow?.bands.map((b) => (
        <g key={b.kind} className="msc-ring-mark" data-mark={markId(flow.prime, b.kind)}>
          <path
            d={b.path}
            className={b.signed < 0 ? "msc-ring-arrow" : `msc-ring-arrow msc-ring-${b.kind}`}
            fill={b.signed < 0 ? `url(#msc-ring-neg-${b.kind})` : undefined}
          />
        </g>
      ))}
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
      <text x={ring.labelX} y={ring.labelY + 4} textAnchor="end" fontSize={13} className="msc-ring-label">
        {label}
      </text>
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
