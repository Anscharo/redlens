import { useCallback, useState } from "react";
import { formatUsd } from "../../lib/settlements";
import type { PrimeStackMonth } from "@/lib/settlementsOverview";
import { MscMonthLabel } from "./MscMonthLabel";
import { MonthColumn } from "./MscTimeseriesColumn";
import { MscTimeseriesPill, type PillHover } from "./MscTimeseriesPill";

// One stack per month: what each Prime sent TO SKY, in the Prime's identity
// color, so the stack's top is the month's To-Sky total. Nothing else is
// drawn on this chart — what a Prime kept is the orbital / flow chart's
// story for the selected month. The month columns double as the overview's
// month selector (same msc-bar-col contract as SettlementBars).
//
// Fixed pixel geometry: the axis/grid overlay and the flex columns must
// agree on x positions, so columns are a fixed COL_W wide with a GAP_PX gap
// after an AXIS_W label gutter.
export const COL_W = 48;
export const GAP_PX = 12;
export const AXIS_W = 46;
// The row's height, and so both charts': the ring card stretches to match
// this and its drawing fills whatever is left under the title.
export const TRACK_H = 470;

// Per-prime categorical fills, assigned by the stable roster order from
// primeStackMonths (fixed order, never re-cycled when a month lacks a prime).
// Dedicated tokens rather than the depth palette: prime identity colors must
// avoid blue, green, orange and brown in EVERY theme — those are the flow
// colors. One slot per Prime that has published; any past that fold to gray.
const PRIME_FILLS = ["--msc-prime-1", "--msc-prime-2", "--msc-prime-3", "--msc-prime-4", "--msc-prime-5", "--msc-prime-6"] as const;
export const primeFill = (i: number): string =>
  `var(${i < PRIME_FILLS.length ? PRIME_FILLS[i] : "--gray"})`;

/** Round tick step: posPeak/6 snapped up to 1/2/5 × 10^n, ticks both ways.
 *  /6 rather than /3 so the axis reads $5m/$10m/$15m/$20m instead of only
 *  the decades — ~6 labels over a 380px track, still round numbers. */
function ticksFor(posPeak: number, negPeak: number): number[] {
  const raw = posPeak / 6;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let t = 0; t <= posPeak; t += step) out.push(t);
  for (let t = -step; t >= -negPeak; t -= step) out.push(t);
  return out;
}

export interface MscTimeseriesProps {
  primes: string[];
  months: PrimeStackMonth[];
  primeLabel: (prime: string) => string;
  selected: string;
  onSelect: (month: string) => void;
}

export function MscTimeseries({ primes, months, primeLabel, selected, onSelect }: MscTimeseriesProps) {
  const posPeak = Math.max(1, ...months.map((m) => m.skyParts.reduce((n, p) => n + Math.max(0, p.value), 0)));
  const negPeak = Math.max(0, ...months.map((m) => -m.skyParts.reduce((n, p) => n + Math.min(0, p.value), 0)));
  const span = posPeak + negPeak;
  // Inset the scale from the track's top/bottom edges so a peak segment
  // never lands exactly on the render boundary.
  const PAD_Y = 8;
  const usableH = TRACK_H - PAD_Y * 2;
  const zeroY = PAD_Y + usableH * (posPeak / span); // y of the zero line from the top
  const px = (v: number) => (v / span) * usableH;
  const y = (v: number) => zeroY - px(v);
  const colorOf = (prime: string) => primeFill(primes.indexOf(prime));
  const width = AXIS_W + months.length * COL_W + (months.length - 1) * GAP_PX;
  const monthKeys = months.map((m) => m.month);
  // The hover pill is portalled out of the chart — see MscTimeseriesPill for
  // why CSS alone cannot put it above the legend. One state write per
  // segment enter/leave, none on mousemove.
  const [hover, setHover] = useState<PillHover | null>(null);
  const clearHover = useCallback(() => setHover(null), []);

  return (
    <div className="mb-4 min-w-0 max-w-full">
      <p className="text-sm mb-2" style={{ color: "var(--tan)" }}>
        To Sky by month, per Prime
      </p>
      <p className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mb-2" style={{ color: "var(--tan-3)", maxWidth: width }}>
        {primes.map((p, i) => (
          <span key={p}>
            <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: primeFill(i) }} />
            {primeLabel(p)}
          </span>
        ))}
      </p>
      <div className="relative inline-block" style={{ maxWidth: "100%", overflowX: "auto" }}>
        <svg className="msc-ts-grid" width={width} height={TRACK_H} aria-hidden="true">
          {ticksFor(posPeak, negPeak).map((t) => (
            <g key={t}>
              <line x1={AXIS_W} x2={width} y1={y(t)} y2={y(t)} className="msc-ts-gridline" />
              <text x={AXIS_W - 6} y={y(t) + 3} textAnchor="end" fontSize={9} className="mono msc-ts-axis">
                {formatUsd(t, true)}
              </text>
            </g>
          ))}
          <line x1={AXIS_W} x2={width} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeWidth={1} />
        </svg>
        <div className="flex items-start relative" style={{ gap: GAP_PX, marginLeft: AXIS_W }} onPointerLeave={clearHover}>
          {months.map((m, i) => (
            <MonthColumn key={m.month} m={m} zeroY={zeroY} px={px} colorOf={colorOf} width={COL_W}
              primeLabel={primeLabel} selected={selected} onSelect={onSelect}
              onHover={setHover} onLeave={clearHover}
              align={i === 0 ? "start" : i === months.length - 1 ? "end" : "center"}
              label={<MscMonthLabel months={monthKeys} index={i} />} />
          ))}
        </div>
      </div>
      <MscTimeseriesPill hover={hover} onDismiss={clearHover} />
    </div>
  );
}
