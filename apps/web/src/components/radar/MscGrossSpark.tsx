import { Link } from "../Link";
import { formatMonth, formatUsd, type GrossMonth } from "../../lib/settlements";

// A small stacked-column chart of a Prime's gross revenue by month, split
// by where it went — to Sky, supply-side kept, demand-side — in the Summary
// chart's colors; the companion to the Monthly settlement box on its actor
// page. The whole chart is a link to the Prime's settlement page, like the
// box beside it. Fixed pixel geometry (the svg scales with its box).
const W = 256;
const H = 120;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 30;
/** Month labels, then the legend, under the columns. */
const PAD_B = 32;
const GAP = 4;

const SERIES = [
  { key: "sky", fill: "var(--msc-sky)" },
  { key: "kept", fill: "var(--msc-kept)" },
  { key: "demand", fill: "var(--msc-demand)" },
] as const;

interface Props {
  points: GrossMonth[];
  href: string;
  /** The Prime's display name, for the link's accessible name. */
  name: string;
}

export function MscGrossSpark({ points, href, name }: Props) {
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
  const total = points.reduce((s, p) => s + p.gross, 0);

  return (
    <Link
      to={href}
      className="msc-teaser-chart"
      aria-label={`${name}: ${formatUsd(total, true)} gross revenue over ${n} ${n === 1 ? "cycle" : "cycles"} — open the settlement charts`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <text x={PAD_L} y={12} fontSize={9} className="mono msc-gross-axis msc-gross-caption">
          gross revenue by month
        </text>
        <text x={PAD_L} y={H - 5} fontSize={9} className="mono msc-gross-axis">
          <tspan fill="var(--msc-sky)">■</tspan> to Sky <tspan fill="var(--msc-kept)">■</tspan> kept <tspan fill="var(--msc-demand)">■</tspan> demand-side
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
              <text x={x(i) + colW / 2} y={H - 18} fontSize={8} textAnchor="middle" className="mono msc-gross-axis">
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
    </Link>
  );
}
