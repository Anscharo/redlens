import { formatMonth, formatUsd } from "../../lib/settlements";
import type { PrimeStackMonth } from "@/lib/settlementsOverview";

// Stacked prime-side earnings (supply kept + demand-side per prime) by month,
// with the disjoint To-Sky total overlaid as a line — no dollar appears in
// both the stack and the line. The month columns double as the overview's
// month selector (same msc-bar-col contract as SettlementBars).
//
// Fixed pixel geometry: the axis/grid/line overlays and the flex columns
// must agree on x positions, so columns are a fixed COL_W wide with a
// GAP_PX gap after an AXIS_W label gutter.
const COL_W = 48;
const GAP_PX = 12;
const AXIS_W = 46;
// Matches the ring's typical rendered height so the two charts read as one row.
const TRACK_H = 380;

// Per-prime categorical fills, assigned by the stable roster order from
// primeStackMonths (fixed order, never re-cycled when a month lacks a prime).
// Dedicated tokens rather than the depth palette: prime identity colors must
// avoid red, green, and blue hues in EVERY theme — blue is reserved for Sky,
// green/red for profit/loss semantics. Primes past the list fold to gray.
const PRIME_FILLS = ["--msc-prime-1", "--msc-prime-2", "--msc-prime-3", "--msc-prime-4", "--msc-prime-5"] as const;
export const primeFill = (i: number): string =>
  `var(${i < PRIME_FILLS.length ? PRIME_FILLS[i] : "--gray"})`;

/** Round tick step: posPeak/3 snapped up to 1/2/5 × 10^n, ticks both ways. */
function ticksFor(posPeak: number, negPeak: number): number[] {
  const raw = posPeak / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let t = 0; t <= posPeak; t += step) out.push(t);
  for (let t = -step; t >= -negPeak; t -= step) out.push(t);
  return out;
}

interface Props {
  primes: string[];
  months: PrimeStackMonth[];
  primeLabel: (prime: string) => string;
  selected: string;
  onSelect: (month: string) => void;
}

export function MscTimeseries({ primes, months, primeLabel, selected, onSelect }: Props) {
  const posPeak = Math.max(
    1,
    ...months.map((m) => Math.max(m.sky, m.parts.reduce((n, p) => n + Math.max(0, p.value), 0))),
  );
  const negPeak = Math.max(0, ...months.map((m) => -m.parts.reduce((n, p) => n + Math.min(0, p.value), 0)));
  const span = posPeak + negPeak;
  // Inset the scale from the track's top/bottom edges — otherwise a peak
  // value lands the line/dot exactly on y=0 (or TRACK_H), clipping its
  // stroke and hit circle at the render boundary.
  const PAD_Y = 8;
  const usableH = TRACK_H - PAD_Y * 2;
  const zeroY = PAD_Y + usableH * (posPeak / span); // y of the zero line from the top
  const px = (v: number) => (v / span) * usableH;
  const y = (v: number) => zeroY - px(v);
  const colorOf = (prime: string) => primeFill(primes.indexOf(prime));
  const width = AXIS_W + months.length * COL_W + (months.length - 1) * GAP_PX;
  const centerX = (i: number) => AXIS_W + i * (COL_W + GAP_PX) + COL_W / 2;

  return (
    <div className="mb-4 min-w-0 max-w-full">
      <p className="text-sm mb-2" style={{ color: "var(--tan)" }}>
        Prime-side earnings by month
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
        <div className="flex items-start relative" style={{ gap: GAP_PX, marginLeft: AXIS_W }}>
          {months.map((m) => (
            <MonthColumn key={m.month} m={m} zeroY={zeroY} px={px} colorOf={colorOf}
              primeLabel={primeLabel} selected={selected} onSelect={onSelect} />
          ))}
        </div>
        <svg className="msc-ts-line" width={width} height={TRACK_H} aria-hidden="true">
          <polyline
            points={months.map((m, i) => `${centerX(i)},${y(m.sky)}`).join(" ")}
            fill="none"
            stroke="var(--msc-sky)"
            strokeWidth={2}
          />
          {months.map((m, i) => {
            const label = formatUsd(m.sky, true);
            const w = label.length * 6.2 + 12;
            // A pill above a near-peak point would clip at the chart's top
            // edge — flip it below the dot instead.
            const below = y(m.sky) < 32;
            return (
              <g key={m.month} className="msc-ts-dot" data-selected={m.month === selected ? "true" : undefined}>
                {/* Oversized invisible hit target so hovering near the line point works. */}
                <circle cx={centerX(i)} cy={y(m.sky)} r={13} fill="transparent" />
                <circle cx={centerX(i)} cy={y(m.sky)} r={3.5} fill="var(--msc-sky)" stroke="var(--bg-deep)" strokeWidth={2} />
                <g className="msc-ts-dot-label">
                  <rect x={centerX(i) - w / 2} y={y(m.sky) + (below ? 8 : -25)} width={w} height={17} rx={8.5} />
                  <text x={centerX(i)} y={y(m.sky) + (below ? 20 : -13)} textAnchor="middle" fontSize={10} className="mono">
                    {label}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mt-2" style={{ color: "var(--tan-3)", maxWidth: width }}>
        {primes.map((p, i) => (
          <span key={p}>
            <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: primeFill(i) }} />
            {primeLabel(p)}
          </span>
        ))}
        <span>
          <span className="inline-block w-3 h-[2px] mr-1 align-middle" style={{ background: "var(--msc-sky)" }} />
          to Sky (line)
        </span>
      </p>
      <p className="mono text-[10px] mt-1" style={{ color: "var(--tan-3)", maxWidth: width }}>
        Each layer is that Prime's supply kept + demand-side; the line is the ecosystem
        To-Sky total, separate money from the stack. The ring splits the selected
        month's bar back into those flows per Prime.
      </p>
    </div>
  );
}

function MonthColumn({ m, zeroY, px, colorOf, primeLabel, selected, onSelect }: {
  m: PrimeStackMonth;
  zeroY: number;
  px: (v: number) => number;
  colorOf: (prime: string) => string;
  primeLabel: (prime: string) => string;
  selected: string;
  onSelect: (month: string) => void;
}) {
  const total = m.parts.reduce((n, p) => n + p.value, 0);
  // Positive parts stack upward from the zero line, negatives downward.
  let up = 0;
  let down = 0;
  const segs = m.parts.map((p) => {
    const h = px(Math.abs(p.value));
    const top = p.value >= 0 ? zeroY - up - h : zeroY + down;
    if (p.value >= 0) up += h;
    else down += h;
    return { ...p, top, h };
  });
  return (
    <button
      type="button"
      className="msc-bar-col"
      style={{ width: COL_W }}
      data-active={m.month === selected ? "true" : undefined}
      onClick={() => onSelect(m.month)}
      aria-pressed={m.month === selected}
      aria-label={`${formatMonth(m.month)}: ${formatUsd(total, true)} prime-side earnings across ${m.parts.length} primes, ${formatUsd(m.sky, true)} to Sky`}
    >
      <span className="msc-ts-track" aria-hidden="true">
        {segs.map((s) => {
          if (s.h < 0.5) return null;
          const fill = colorOf(s.prime);
          // A negative month keeps the prime's own color (color = identity)
          // and is marked by diagonal stripes, stacked below the zero line.
          const background =
            s.value < 0
              ? `repeating-linear-gradient(45deg, ${fill} 0, ${fill} 4px, transparent 4px, transparent 8px)`
              : fill;
          return (
            <span
              key={s.prime}
              className="msc-ts-seg"
              data-prime={s.prime}
              title={`${primeLabel(s.prime)}: ${formatUsd(s.value, true)}`}
              style={{ top: s.top, height: s.h, background }}
            />
          );
        })}
      </span>
      <span className="mono text-[10px]">{formatMonth(m.month)}</span>
    </button>
  );
}
