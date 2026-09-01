import { formatMonth, formatUsd } from "../../lib/settlements";
import type { PrimeStackMonth } from "@/lib/settlementsOverview";

// Stacked prime-side earnings (supply kept + demand-side per prime) by month,
// with the disjoint To-Sky total overlaid as a line — no dollar appears in
// both the stack and the line. The month columns double as the overview's
// month selector (same msc-bar-col contract as SettlementBars).
//
// Fixed pixel geometry: the line overlay and the flex columns must agree on
// x positions, so columns are a fixed COL_W wide with a GAP_PX gap.
const COL_W = 48;
const GAP_PX = 12;
// Matches the ring's typical rendered height so the two charts read as one row.
const TRACK_H = 380;

// Per-prime categorical fills, assigned by the stable roster order from
// primeStackMonths (fixed order, never re-cycled when a month lacks a prime).
// --depth-4 is skipped entirely (it is the dark theme's --msc-sky, and the
// To-Sky line must never share a color with a stack layer) and --depth-2 is
// pushed last (the light theme's is a blue near --msc-sky, so it goes to the
// smallest prime). Primes past the list fold to the muted gray.
const PRIME_FILLS = ["--depth-1", "--depth-3", "--depth-5", "--depth-6", "--depth-2"] as const;
export const primeFill = (i: number): string =>
  `var(${i < PRIME_FILLS.length ? PRIME_FILLS[i] : "--gray"})`;

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
  const zeroY = TRACK_H * (posPeak / span); // y of the zero line from the top
  const px = (v: number) => (v / span) * TRACK_H;
  const colorOf = (prime: string) => primeFill(primes.indexOf(prime));
  const width = months.length * COL_W + (months.length - 1) * GAP_PX;

  return (
    <div className="mb-4 min-w-0 max-w-full">
      <p className="mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--tan-3)" }}>
        Prime-side earnings by month
      </p>
      <div className="relative inline-block" style={{ maxWidth: "100%", overflowX: "auto" }}>
        <div className="flex items-start" style={{ gap: GAP_PX }} role="group" aria-label="Settlement months">
          {months.map((m) => (
            <MonthColumn key={m.month} m={m} zeroY={zeroY} px={px} colorOf={colorOf}
              primeLabel={primeLabel} selected={selected} onSelect={onSelect} />
          ))}
        </div>
        <svg
          className="msc-ts-line"
          width={width}
          height={TRACK_H}
          viewBox={`0 0 ${width} ${TRACK_H}`}
          aria-hidden="true"
        >
          <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="var(--border)" strokeWidth={1} />
          <polyline
            points={months.map((m, i) => `${i * (COL_W + GAP_PX) + COL_W / 2},${zeroY - px(m.sky)}`).join(" ")}
            fill="none"
            stroke="var(--msc-sky)"
            strokeWidth={2}
          />
          {months.map((m, i) => (
            <circle
              key={m.month}
              cx={i * (COL_W + GAP_PX) + COL_W / 2}
              cy={zeroY - px(m.sky)}
              r={3.5}
              fill="var(--msc-sky)"
              stroke="var(--bg)"
              strokeWidth={2}
            />
          ))}
        </svg>
      </div>
      <p className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1 mt-2" style={{ color: "var(--tan-3)" }}>
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
        {segs.map((s) =>
          s.h >= 0.5 ? (
            <span
              key={s.prime}
              className="msc-ts-seg"
              title={`${primeLabel(s.prime)}: ${formatUsd(s.value, true)}`}
              style={{ top: s.top, height: s.h, background: s.value < 0 ? "var(--accent)" : colorOf(s.prime) }}
            />
          ) : null,
        )}
      </span>
      <span className="mono text-[10px]">{formatMonth(m.month)}</span>
    </button>
  );
}
