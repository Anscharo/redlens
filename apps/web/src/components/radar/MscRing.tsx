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
        <RingPrimeGroup key={p.flow.prime} {...p} month={month} chartHeight={layout.height} />
      ))}
    </svg>
  );
}

/** Amount-pill text names what it is, not just the number — a bare "$2.6M"
 *  is meaningless once several pills are visible over one prime. */
function pillText(kind: "sky" | "kept" | "demand", signed: number, primeLabel: string): string {
  const amount = formatUsd(signed, true);
  if (kind === "sky") return `${amount} to Sky`;
  if (kind === "kept") return `${amount} supply kept`;
  return `${amount} demand-side to ${primeLabel}`;
}

function RingPrimeGroup({
  flow,
  ring,
  label,
  bandColor,
  to,
  month,
  chartHeight,
}: MscRingPrime & { month: string; chartHeight: number }) {
  // One prime's pills are stacked in a single vertical column instead of
  // floating at each flow/slice's own centroid — independently-placed pills
  // sat on top of each other and hid what they were pointing at.
  const amounts = [
    ...ring.flows.map((f) => ({ key: `flow-${f.kind}`, signed: f.signed, text: pillText(f.kind, f.signed, label) })),
    ...ring.slices
      .filter((s) => s.kind !== "sky")
      .map((s) => ({ key: `slice-${s.kind}`, signed: s.signed, text: pillText(s.kind, s.signed, label) })),
  ];
  const PILL_H = 22;
  const PILL_GAP = 4;
  const stackH = amounts.length * PILL_H + Math.max(0, amounts.length - 1) * PILL_GAP;
  const spaceBelow = chartHeight - (ring.cy + ring.r);
  const spaceAbove = ring.cy - ring.r;
  const below = spaceBelow >= stackH + 16 || spaceAbove < stackH + 16;
  const startY = below ? ring.cy + ring.r + 14 : ring.cy - ring.r - 14 - stackH;

  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      <title>{breakdown(flow)}</title>
      {/* Outlined, not solid: a filled circle would read like a flow. The
          faint tint keeps the whole circle hoverable/clickable. */}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} className="msc-ring-band" style={{ stroke: bandColor, fill: bandColor }} />
      {/* Pie slices: the circle's own To Sky (CoF + SDE) / kept / demand mix. */}
      {ring.slices.map((s) => (
        <path
          key={s.kind}
          d={s.path}
          className={`msc-ring-slice${s.signed < 0 ? "" : ` msc-ring-${s.kind}`}`}
          fill={s.signed < 0 ? `url(#msc-ring-neg-${s.kind})` : undefined}
        />
      ))}
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
        {amounts.map((a, i) => {
          const y = startY + i * (PILL_H + PILL_GAP);
          // Pill background sized from the mono text (~6.4px/char at 12px).
          const w = a.text.length * 6.4 + 16;
          return (
            <g key={a.key}>
              <rect x={ring.cx - w / 2} y={y} width={w} height={PILL_H} rx={PILL_H / 2} />
              <text x={ring.cx} y={y + PILL_H / 2 + 4} textAnchor="middle" fontSize={12} className="mono">
                {a.text}
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
