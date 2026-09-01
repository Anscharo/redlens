import { startTransition } from "react";
import { useLocation, useRouter } from "wouter";
import {
  DEMAND_SERIES,
  SETTLEMENT_NEAR_ZERO,
  formatMonth,
  formatUsd,
} from "../../lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import type { RingLayout, RingPrime } from "../../lib/mscOverviewLayout";

export interface MscRingPrime {
  flow: PrimeFlowTotals;
  ring: RingPrime;
  label: string;
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
      viewBox={`0 0 ${layout.size} ${layout.size}`}
      role="img"
      aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}
    >
      <circle cx={layout.cx} cy={layout.cy} r={layout.skyR} className="msc-ring-sky-disc" />
      <text x={layout.cx} y={layout.cy - 4} textAnchor="middle" fontSize={15} className="msc-ring-center">
        Sky
      </text>
      <text x={layout.cx} y={layout.cy + 14} textAnchor="middle" fontSize={12} className="msc-ring-center mono">
        {centerFigure}
      </text>
      {primes.map((p) => (
        <RingPrimeGroup key={p.flow.prime} {...p} month={month} />
      ))}
    </svg>
  );
}

function RingPrimeGroup({ flow, ring, label, to, month }: MscRingPrime & { month: string }) {
  const { base } = useRouter();
  const [, navigate] = useLocation();
  const group = (
    <g className="msc-ring-prime" data-prime={flow.prime}>
      <title>{breakdown(flow)}</title>
      <path d={ring.arcPath} className="msc-ring-band" />
      {ring.flows.map((f) => (
        <path
          key={f.kind}
          d={f.path}
          className={f.signed < 0 ? "msc-ring-loss" : `msc-ring-${f.kind}`}
        />
      ))}
      <text
        x={ring.labelX}
        y={ring.labelY}
        textAnchor={ring.labelAnchor}
        fontSize={12}
        className="msc-ring-label"
      >
        {label}
      </text>
      <g className="msc-ring-amounts" aria-hidden="true">
        {ring.flows.map((f) => (
          <text key={f.kind} x={f.amountX} y={f.amountY} textAnchor="middle" fontSize={10}>
            {formatUsd(f.signed, true)}
          </text>
        ))}
      </g>
    </g>
  );
  if (!to) return group;
  // The app's <Link> renders an HTML anchor — invalid inside <svg> — so this
  // SVG <a> replicates its behavior: modifier/non-left clicks fall through to
  // the browser (the href is base-prefixed so open-in-new-tab works in
  // preview deployments), plain clicks navigate inside startTransition so the
  // lazy route doesn't flash a Suspense fallback. `navigate` prefixes the
  // base itself, so it gets the unprefixed path.
  const onClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    startTransition(() => navigate(to));
  };
  return (
    <a
      href={`${base}${to}`}
      onClick={onClick}
      aria-label={`${label}, ${formatMonth(month)}: ${formatUsd(flow.sky, true)} to Sky, ${formatUsd(flow.kept, true)} supply kept, ${formatUsd(flow.demand, true)} demand-side. Open settlement page.`}
    >
      {group}
    </a>
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
