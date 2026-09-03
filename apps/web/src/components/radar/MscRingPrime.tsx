import { formatMonth, formatUsd } from "../../lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import type { RingLossNote, RingPrime } from "../../lib/mscOverviewLayout";
import { SvgRouteLink } from "./SvgRouteLink";
import { markId } from "./MscRingPills";

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

/** A negative kept/demand can't be a pie wedge, so it's called out here
 *  instead — always visible (not hover-gated), with the same striped swatch
 *  the key uses for "negative flow". */
function LossNotes({ ring }: { ring: RingPrime }) {
  if (ring.lossNotes.length === 0) return null;
  return (
    <g className="msc-ring-loss-notes">
      {ring.lossNotes.map((n: RingLossNote, i: number) => {
        const y = ring.cy + ring.r + 16 + i * 14;
        const text = `${formatUsd(n.signed, true)} ${n.kind === "kept" ? "supply kept" : "demand-side"}`;
        return (
          <g key={n.kind}>
            <rect x={ring.cx - 4} y={y - 8} width={8} height={8} fill={`url(#msc-ring-neg-${n.kind})`} />
            <text x={ring.cx + 8} y={y} textAnchor="start" fontSize={10} className="msc-ring-loss-label mono">
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      {/* Outlined, not solid: a filled circle would read like a flow. The
          faint tint keeps the whole circle hoverable/clickable. Its AREA is
          the prime's own revenue — the To-Sky pass-through is not in it. */}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} className="msc-ring-band" style={{ stroke: bandColor, fill: bandColor }} />
      {/* Pie slices: the circle's own POSITIVE revenue mix (supply kept /
          demand-side). To Sky is a pass-through, not revenue — it never gets
          a wedge here, only the ribbon below. */}
      {ring.slices.map((s) => (
        <g key={s.kind} className="msc-ring-mark" data-mark={markId(flow.prime, s.kind)}>
          <path d={s.path} className={`msc-ring-slice msc-ring-${s.kind}`} />
        </g>
      ))}
      {ring.flows.map((f) => (
        <g key={f.kind} className="msc-ring-mark" data-mark={markId(flow.prime, f.kind)}>
          <path
            d={f.path}
            className={f.signed < 0 ? undefined : `msc-ring-${f.kind}`}
            fill={f.signed < 0 ? `url(#msc-ring-neg-${f.kind})` : undefined}
          />
        </g>
      ))}
      {ring.leaderPath && <path d={ring.leaderPath} className="msc-ring-leader" aria-hidden="true" />}
      <text
        x={ring.labelX}
        y={ring.labelY + 4}
        textAnchor={ring.labelAnchor}
        fontSize={ring.labelMode === "circle" ? 14 : 13}
        className={ring.labelMode === "circle" ? "msc-ring-label msc-ring-label-band" : "msc-ring-label"}
      >
        {label}
      </text>
      <LossNotes ring={ring} />
    </g>
  );
  if (!to) return group;
  return (
    <SvgRouteLink
      to={to}
      label={`${label}, ${formatMonth(month)}: ${formatUsd(flow.sky, true)} to Sky, ${formatUsd(flow.kept, true)} supply kept, ${formatUsd(flow.demand, true)} demand-side. Open settlement page.`}
    >
      {group}
    </SvgRouteLink>
  );
}
