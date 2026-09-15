import { formatMonth, formatUsd, type GrossMonth } from "../../lib/settlements";

// A small stacked-column chart of a Prime's gross revenue by month, split
// by where it went — to Sky, supply-side kept, demand-side — in the Summary
// chart's colors; the right half of the Monthly settlement card on its
// actor page (the card itself is the link). Fixed pixel geometry (the svg
// scales with its box); the legend is HTML under it, on the same line as
// the figures' "full cycle" link.
const W = 256;
const H = 100;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 30;
/** Month labels under the columns. */
const PAD_B = 16;
const GAP = 4;

const SERIES = [
  { key: "sky", label: "to Sky", fill: "var(--msc-sky)" },
  { key: "kept", label: "kept", fill: "var(--msc-kept)" },
  { key: "demand", label: "demand-side", fill: "var(--msc-demand)" },
] as const;

export function MscGrossSpark({ points }: { points: GrossMonth[] }) {
  const n = points.length;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const up = (p: GrossMonth) => SERIES.reduce((s, { key }) => s + Math.max(0, p[key]), 0);
  const down = (p: GrossMonth) => SERIES.reduce((s, { key }) => s + Math.min(0, p[key]), 0);
  const hi = Math.max(1, ...points.map(up));
  const lo = Math.min(0, ...points.map(down));
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * innerH;
  const zero = y(0);
  const slot = innerW / n;
  const colW = Math.min(28, slot - GAP);
  const x = (i: number) => PAD_L + i * slot + (slot - colW) / 2;

  return (
    <div className="msc-teaser-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <text x={PAD_L} y={12} fontSize={9} className="mono msc-gross-axis msc-gross-caption">
          gross revenue by month
        </text>
        <line x1={PAD_L} x2={W - PAD_R} y1={zero} y2={zero} className="msc-gross-zero" />
        {points.map((p, i) => {
          // Positive parts stack up from the zero line, negatives down.
          let top = zero;
          let bottom = zero;
          const anchor = i < n / 3 ? "start" : i > (2 * n) / 3 ? "end" : "middle";
          return (
            <g key={p.month} className="msc-gross-col">
              <rect x={PAD_L + i * slot} y={0} width={slot} height={H} fill="transparent" />
              {SERIES.map(({ key, fill }) => {
                const v = p[key];
                if (Math.abs(v) < 0.5) return null;
                const h = Math.abs(y(0) - y(v));
                const ry = v > 0 ? (top -= h) : bottom;
                if (v < 0) bottom += h;
                return <rect key={key} x={x(i)} y={ry} width={colW} height={h} fill={fill} data-series={key} />;
              })}
              <text x={x(i) + colW / 2} y={H - 4} fontSize={8} textAnchor="middle" className="mono msc-gross-axis">
                {formatMonth(p.month).slice(0, 3)}
              </text>
              <text x={x(i) + colW / 2} y={12} fontSize={9} textAnchor={anchor} className="mono msc-gross-pill msc-gross-hover">
                {`${formatMonth(p.month)} · ${formatUsd(p.gross, true)} gross`}
              </text>
              <text x={x(i) + colW / 2} y={23} fontSize={9} textAnchor={anchor} className="mono msc-gross-pill msc-gross-hover">
                {`to Sky ${formatUsd(p.sky, true)} · kept ${formatUsd(p.kept, true)} · demand ${formatUsd(p.demand, true)}`}
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
