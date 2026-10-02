import { formatMonth, formatUsd } from "../../lib/settlements";
import type { PrimeStackMonth } from "@/lib/settlementsOverview";
import { pillHoverFrom, type PillHover } from "./MscTimeseriesPill";

/**
 * "12.4m" — the month's To-Sky total, to the nearest $100k, floated above
 * the bar. `formatUsd(n, true)` cannot make this shape: it emits "$12.40M"
 * (currency sign, two decimals) and switches to "$950k" under a million,
 * which is both wider than a 48px column and a different precision than the
 * nearest-$100k figure asked for here.
 */
export function formatBarTotal(n: number): string {
  const rounded = Math.round(n / 100_000) * 100_000;
  const sign = rounded < 0 ? "−" : "";
  const abs = Math.abs(rounded);
  if (abs === 0) return "0";
  return abs >= 1_000_000 ? `${sign}${(abs / 1_000_000).toFixed(1)}m` : `${sign}${abs / 1_000}k`;
}

export function MonthColumn({ m, zeroY, px, colorOf, primeLabel, selected, onSelect, align, label, width, onHover, onLeave }: {
  m: PrimeStackMonth;
  label: React.ReactNode;
  zeroY: number;
  px: (v: number) => number;
  colorOf: (prime: string) => string;
  primeLabel: (prime: string) => string;
  selected: string;
  onSelect: (month: string) => void;
  width: number;
  onHover: (h: PillHover) => void;
  onLeave: () => void;
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
  // The month's figure floats just above the positive stack — or just above
  // the zero line when there is no positive stack to sit on. Clamped so a
  // peak column's figure is never clipped by the scrolling chart wrapper.
  const totalTop = Math.max(0, (m.sky > 0 ? zeroY - up : zeroY) - 13);
  return (
    <button
      type="button"
      className="msc-bar-col"
      style={{ width }}
      data-active={m.month === selected ? "true" : undefined}
      onClick={() => onSelect(m.month)}
      aria-pressed={m.month === selected}
      aria-label={`${formatMonth(m.month)}: ${formatUsd(m.sky, true)} to Sky across ${m.skyParts.length} ${m.skyParts.length === 1 ? "prime" : "primes"}`}
    >
      <span className="msc-ts-tracks" aria-hidden="true">
        <span className="msc-ts-total mono" style={{ top: totalTop, color: "var(--msc-sky)" }}>
          {formatBarTotal(m.sky)}
        </span>
        <span className="msc-ts-track msc-ts-track-sky" data-flow="sky">
          {segs.map((s) =>
            s.h < 0.5 ? null : (
              <span
                key={s.prime}
                className="msc-ts-seg"
                data-prime={s.prime}
                data-flow="sky"
                style={{ top: s.top, height: s.h, background: s.value < 0 ? stripes : colorOf(s.prime) }}
                onPointerEnter={(e) =>
                  onHover(pillHoverFrom(e.currentTarget, `${primeLabel(s.prime)} ${formatUsd(s.value, true)} to Sky`, align))
                }
                onPointerLeave={onLeave}
              />
            ),
          )}
        </span>
      </span>
      {label}
    </button>
  );
}
