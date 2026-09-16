import { formatMonth, formatUsd, type ThreeWayMonth } from "../../lib/settlements";

// A small month-by-month chart of a Prime's settlement cycles, as three
// CLUSTERED bars per month — what it owed Sky, what it kept supply-side,
// what Sky owed it demand-side — the same three series, same colors and
// same clustered shape as the monthly summary on its settlement page, so
// this card is a preview of that chart rather than a different one.
//
// Deliberately not stacked: stacking reads as a total, and these three
// never form one. The supply and demand sides settle as two amounts
// running in opposite directions (A.2.4.1.2.2.1.1.1 and
// A.2.4.1.2.2.1.1.2), and the Atlas defines no term for their sum.
//
// Fixed pixel geometry (the svg scales with its box); the legend is HTML
// under it, on the same line as the figures' "full cycle" link.
const W = 256;
const H = 100;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 30;
/** Month labels under the columns. */
const PAD_B = 16;
/** Between one month's cluster and the next. */
const SLOT_GAP = 5;
/** Between the three bars of one month. */
const BAR_GAP = 1;
/** A bar never vanishes entirely: a hairline still says "this exists". */
const MIN_H = 1;

const SERIES = [
  { key: "sky", label: "to Sky", fill: "var(--msc-sky)" },
  { key: "kept", label: "supply-side kept", fill: "var(--msc-kept)" },
  { key: "demand", label: "demand-side", fill: "var(--msc-demand)" },
] as const;

export function MscCycleSpark({ points }: { points: ThreeWayMonth[] }) {
  const n = points.length;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const all = points.flatMap((p) => SERIES.map(({ key }) => p[key]));
  const hi = Math.max(1, ...all);
  const lo = Math.min(0, ...all);
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * innerH;
  const zero = y(0);
  const slot = innerW / n;
  const clusterW = Math.max(3, slot - SLOT_GAP);
  const barW = (clusterW - BAR_GAP * (SERIES.length - 1)) / SERIES.length;
  const x = (i: number) => PAD_L + i * slot + (slot - clusterW) / 2;

  return (
    <div className="msc-teaser-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <text x={PAD_L} y={12} fontSize={9} className="mono msc-gross-axis msc-gross-caption">
          by month
        </text>
        <line x1={PAD_L} x2={W - PAD_R} y1={zero} y2={zero} className="msc-gross-zero" />
        {points.map((p, i) => {
          const anchor = i < n / 3 ? "start" : i > (2 * n) / 3 ? "end" : "middle";
          return (
            <g key={p.month} className="msc-gross-col">
              <rect x={PAD_L + i * slot} y={0} width={slot} height={H} fill="transparent" />
              {SERIES.map(({ key, fill }, s) => {
                const v = p[key];
                // Negative bars hang below the zero line; positives sit on it.
                const h = Math.max(MIN_H, Math.abs(y(0) - y(v)));
                return (
                  <rect
                    key={key}
                    x={x(i) + s * (barW + BAR_GAP)}
                    y={v < 0 ? zero : zero - h}
                    width={barW}
                    height={h}
                    fill={fill}
                    data-series={key}
                    data-negative={v < 0 ? "true" : undefined}
                  />
                );
              })}
              <text x={x(i) + clusterW / 2} y={H - 4} fontSize={8} textAnchor="middle" className="mono msc-gross-axis">
                {formatMonth(p.month).slice(0, 3)}
              </text>
              <text x={x(i) + clusterW / 2} y={12} fontSize={9} textAnchor={anchor} className="mono msc-gross-pill msc-gross-hover">
                {formatMonth(p.month)}
              </text>
              <text x={x(i) + clusterW / 2} y={23} fontSize={9} textAnchor={anchor} className="mono msc-gross-pill msc-gross-hover">
                {`${formatUsd(p.sky, true)} to Sky · ${formatUsd(p.kept, true)} kept · ${formatUsd(p.demand, true)} demand`}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="msc-gross-legend mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        {SERIES.map(({ key, label, fill }) => (
          <span key={key}>
            <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background: fill }} /> {label}
          </span>
        ))}
      </p>
    </div>
  );
}
