import { formatMonth, formatUsd } from "../../lib/settlements";
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

/** Amount-pill text names what it is, not just the number — a bare "$2.6M"
 *  is meaningless without saying which flow it's naming. */
function pillText(kind: "sky" | "kept" | "demand", signed: number, primeLabel: string): string {
  const amount = formatUsd(signed, true);
  if (kind === "sky") return `${amount} to Sky`;
  if (kind === "kept") return `${amount} supply kept`;
  return `${amount} demand-side to ${primeLabel}`;
}

/** One shape's hover-amount pill, anchored at that shape's own centroid.
 *  Scoped to `.msc-ring-mark` (its wrapping `<g>`) so only the shape actually
 *  under the pointer reveals its pill — showing every pill on prime hover
 *  buried them on top of each other. */
function AmountPill({ x, y, text }: { x: number; y: number; text: string }) {
  const w = text.length * 6.4 + 16;
  const h = 22;
  return (
    <g className="msc-ring-amounts" aria-hidden="true">
      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h / 2} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} className="mono">
        {text}
      </text>
    </g>
  );
}

function RingPrimeGroup({ flow, ring, label, bandColor, to, month }: MscRingPrime & { month: string }) {
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      {/* Outlined, not solid: a filled circle would read like a flow. The
          faint tint keeps the whole circle hoverable/clickable. */}
      <circle cx={ring.cx} cy={ring.cy} r={ring.r} className="msc-ring-band" style={{ stroke: bandColor, fill: bandColor }} />
      {/* Pie slices: the circle's own To Sky (CoF + SDE) / kept / demand mix. */}
      {ring.slices.map((s) => (
        <g key={s.kind} className="msc-ring-mark">
          <path
            d={s.path}
            className={`msc-ring-slice${s.signed < 0 ? "" : ` msc-ring-${s.kind}`}`}
            fill={s.signed < 0 ? `url(#msc-ring-neg-${s.kind})` : undefined}
          />
          <AmountPill x={s.amountX} y={s.amountY} text={pillText(s.kind, s.signed, label)} />
        </g>
      ))}
      {ring.flows.map((f) => (
        <g key={f.kind} className="msc-ring-mark">
          <path
            d={f.path}
            className={f.signed < 0 ? undefined : `msc-ring-${f.kind}`}
            fill={f.signed < 0 ? `url(#msc-ring-neg-${f.kind})` : undefined}
          />
          <AmountPill x={f.amountX} y={f.amountY} text={pillText(f.kind, f.signed, label)} />
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
