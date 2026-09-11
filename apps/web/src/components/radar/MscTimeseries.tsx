import { formatMonth, formatUsd } from "../../lib/settlements";
import type { PrimeStackMonth } from "@/lib/settlementsOverview";

// One stack per month: what each Prime sent TO SKY, in the Prime's identity
// color, so the stack's top is the month's To-Sky total. Nothing else is
// drawn on this chart — what a Prime kept is the orbital / flow chart's
// story for the selected month. The month columns double as the overview's
// month selector (same msc-bar-col contract as SettlementBars).
//
// Fixed pixel geometry: the axis/grid overlay and the flex columns must
// agree on x positions, so columns are a fixed COL_W wide with a GAP_PX gap
// after an AXIS_W label gutter.
const COL_W = 48;
const GAP_PX = 12;
const AXIS_W = 46;
// Matches the ring's typical rendered height so the two charts read as one row.
const TRACK_H = 380;

// Per-prime categorical fills, assigned by the stable roster order from
// primeStackMonths (fixed order, never re-cycled when a month lacks a prime).
// Dedicated tokens rather than the depth palette: prime identity colors must
// avoid blue, green, orange and brown in EVERY theme — those are the flow
// colors. One slot per Prime that has published; any past that fold to gray.
const PRIME_FILLS = ["--msc-prime-1", "--msc-prime-2", "--msc-prime-3", "--msc-prime-4", "--msc-prime-5", "--msc-prime-6"] as const;
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
  /** Autoplay through the months (the overview advances `selected`). */
  playing: boolean;
  onTogglePlay: () => void;
}

export function MscTimeseries({ primes, months, primeLabel, selected, onSelect, playing, onTogglePlay }: Props) {
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

  return (
    <div className="mb-4 min-w-0 max-w-full">
      <p className="text-sm mb-2 flex items-center gap-3" style={{ color: "var(--tan)" }}>
        <span>To Sky by month, per Prime</span>
        <button
          type="button"
          className="msc-ts-play mono text-[10px]"
          onClick={onTogglePlay}
          aria-pressed={playing}
          aria-label={playing ? "Pause the month autoplay" : "Play through the months, one second each"}
        >
          {playing ? "❚❚ pause" : "▶ play"}
        </button>
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
        <div className="flex items-start relative" style={{ gap: GAP_PX, marginLeft: AXIS_W }}>
          {months.map((m, i) => (
            <MonthColumn key={m.month} m={m} zeroY={zeroY} px={px} colorOf={colorOf}
              primeLabel={primeLabel} selected={selected} onSelect={onSelect}
              align={i === 0 ? "start" : i === months.length - 1 ? "end" : "center"} />
          ))}
        </div>
      </div>
    </div>
  );
}

function MonthColumn({ m, zeroY, px, colorOf, primeLabel, selected, onSelect, align }: {
  m: PrimeStackMonth;
  zeroY: number;
  px: (v: number) => number;
  colorOf: (prime: string) => string;
  primeLabel: (prime: string) => string;
  selected: string;
  onSelect: (month: string) => void;
  /** Where a segment's hover pill hangs: edge columns keep theirs inside
   *  the chart instead of overflowing it. */
  align: "start" | "center" | "end";
}) {
  // Positive parts stack upward from the zero line, negatives downward.
  let up = 0;
  let down = 0;
  const segs = m.skyParts.map((p) => {
    const h = px(Math.abs(p.value));
    const top = p.value >= 0 ? zeroY - up - h : zeroY + down;
    if (p.value >= 0) up += h;
    else down += h;
    return { ...p, top, h };
  });
  // A negative month (a Prime owed less than nothing) is the loss mark:
  // stripes in the loss red, stacked below the zero line.
  const stripes = "repeating-linear-gradient(45deg, var(--msc-loss) 0, var(--msc-loss) 4px, transparent 4px, transparent 8px)";
  return (
    <button
      type="button"
      className="msc-bar-col"
      style={{ width: COL_W }}
      data-active={m.month === selected ? "true" : undefined}
      onClick={() => onSelect(m.month)}
      aria-pressed={m.month === selected}
      aria-label={`${formatMonth(m.month)}: ${formatUsd(m.sky, true)} to Sky across ${m.skyParts.length} ${m.skyParts.length === 1 ? "prime" : "primes"}`}
    >
      <span className="msc-ts-tracks" aria-hidden="true">
        <span className="msc-ts-track msc-ts-track-sky" data-flow="sky">
          {segs.map((s) =>
            s.h < 0.5 ? null : (
              <span
                key={s.prime}
                className="msc-ts-seg"
                data-prime={s.prime}
                data-flow="sky"
                style={{ top: s.top, height: s.h, background: s.value < 0 ? stripes : colorOf(s.prime) }}
              >
                <span className="msc-ts-pill mono" data-align={align}>
                  {`${primeLabel(s.prime)} ${formatUsd(s.value, true)} to Sky`}
                </span>
              </span>
            ),
          )}
        </span>
      </span>
      <span className="mono text-[10px]">{formatMonth(m.month)}</span>
    </button>
  );
}
