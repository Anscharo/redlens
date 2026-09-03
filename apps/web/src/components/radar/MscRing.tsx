import {
  DEMAND_SERIES,
  SETTLEMENT_NEAR_ZERO,
  formatMonth,
  formatUsd,
} from "../../lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import type { RingLayout, RingPrime } from "../../lib/mscOverviewLayout";
import { SvgRouteLink } from "./SvgRouteLink";

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

interface Props {
  layout: RingLayout;
  primes: MscRingPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure shown inside the disc. */
  centerFigure: string;
}

export function MscRing({ layout, primes, month, centerFigure }: Props) {
  return (
    <svg
      className="msc-ring"
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}
    >
      {/* Diagonal stripes in each series' own color: a negative flow keeps
          its category color (colors mean category on this chart) and is
          marked by stripes + reversed direction instead of a "loss" hue. */}
      <defs>
        {(["sky", "kept", "demand"] as const).map((k) => (
          <pattern
            key={k}
            id={`msc-ring-neg-${k}`}
            patternUnits="userSpaceOnUse"
            width={6}
            height={6}
            patternTransform="rotate(45)"
          >
            <rect width={3.5} height={6} style={{ fill: `var(--msc-${k})` }} />
          </pattern>
        ))}
      </defs>
      <circle cx={layout.cx} cy={layout.cy} r={layout.skyR} className="msc-ring-sky-disc" />
      <text x={layout.cx} y={layout.cy - 6} textAnchor="middle" fontSize={20} className="msc-ring-center">
        Sky
      </text>
      <text x={layout.cx} y={layout.cy + 18} textAnchor="middle" fontSize={17} className="msc-ring-center mono">
        {centerFigure}
      </text>
      {primes.map((p) => (
        <RingPrimeGroup key={p.flow.prime} {...p} month={month} />
      ))}
    </svg>
  );
}

function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      <title>{breakdown(flow)}</title>
      {/* Outlined, not solid: a filled circle would read like a flow. The
          faint tint keeps the whole circle hoverable/clickable. */}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} className="msc-ring-band" style={{ stroke: bandColor, fill: bandColor }} />
      {ring.flows.map((f) => (
        <path
          key={f.kind}
          d={f.path}
          className={f.signed < 0 ? undefined : `msc-ring-${f.kind}`}
          fill={f.signed < 0 ? `url(#msc-ring-neg-${f.kind})` : undefined}
        />
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
      <g className="msc-ring-amounts" aria-hidden="true">
        {ring.flows.map((f) => {
          const label = formatUsd(f.signed, true);
          // Pill background sized from the mono text (~9.6px/char at 16px).
          const w = label.length * 9.6 + 16;
          return (
            <g key={f.kind}>
              <rect x={f.amountX - w / 2} y={f.amountY - 15} width={w} height={24} rx={12} />
              <text x={f.amountX} y={f.amountY + 3} textAnchor="middle" fontSize={16} className="mono">
                {label}
              </text>
            </g>
          );
        })}
      </g>
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

/** Full hover breakdown, sub-categories included (they never get their own
 *  ribbons): CoF/SDE as components of To Sky, the demand parts under
 *  demand-side. Near-zero parts omitted. */
function breakdown(f: PrimeFlowTotals): string {
  const skyParts: string[] = [];
  if (Math.abs(f.cof) >= SETTLEMENT_NEAR_ZERO) skyParts.push(`cost of funds ${formatUsd(f.cof, true)}`);
  if (Math.abs(f.sde) >= SETTLEMENT_NEAR_ZERO) skyParts.push(`Sky Direct Exposure ${formatUsd(f.sde, true)}`);
  const demandParts = DEMAND_SERIES.filter((s) => f.demandParts[s.key] != null).map(
    (s) => `${s.label.toLowerCase()} ${formatUsd(f.demandParts[s.key]!, true)}`,
  );
  return [
    `To Sky ${formatUsd(f.sky, true)}${skyParts.length ? ` (of which ${skyParts.join(", ")})` : ""}`,
    `Supply kept ${formatUsd(f.kept, true)}`,
    `Demand-side ${formatUsd(f.demand, true)}${demandParts.length ? ` (${demandParts.join(", ")})` : ""}`,
  ].join(" · ");
}
