import { Link } from "../Link";
import { formatMonth, formatUsd, type CumulativeMonth } from "../../lib/settlements";

// A small area chart of a Prime's running To-Sky total, month by month —
// the companion to the Monthly settlement box on its actor page. The whole
// chart is a link to the Prime's settlement page, like the box beside it.
// Fixed pixel geometry (the svg scales with its box via the viewBox).
const W = 256;
const H = 120;
const PAD_L = 6;
const PAD_R = 6;
const PAD_T = 24;
const PAD_B = 20;

interface Props {
  points: CumulativeMonth[];
  href: string;
  /** The Prime's display name, for the link's accessible name. */
  name: string;
}

export function MscCumulativeSpark({ points, href, name }: Props) {
  const n = points.length;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const hi = Math.max(1, ...points.map((p) => p.cumulative));
  const lo = Math.min(0, ...points.map((p) => p.cumulative));
  const x = (i: number) => (n === 1 ? PAD_L + innerW / 2 : PAD_L + (i * innerW) / (n - 1));
  const y = (v: number) => PAD_T + ((hi - v) / (hi - lo)) * innerH;
  const zero = y(0);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.cumulative)}`).join(" ");
  const area = `${line} L${x(n - 1)},${zero} L${x(0)},${zero} Z`;
  const last = points[n - 1];
  const first = points[0];
  const total = formatUsd(last.cumulative, true);

  return (
    <Link
      to={href}
      className="msc-teaser-chart"
      aria-label={`${name}: ${total} to Sky over ${n} ${n === 1 ? "cycle" : "cycles"}, cumulative — open the settlement charts`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
        <text x={PAD_L} y={12} fontSize={9} className="mono msc-cum-axis msc-cum-caption">
          cumulative to Sky
        </text>
        <line x1={PAD_L} x2={W - PAD_R} y1={zero} y2={zero} className="msc-cum-zero" />
        {n > 1 && <path d={area} className="msc-cum-area" />}
        {n > 1 && <path d={line} className="msc-cum-line" />}
        <circle cx={x(n - 1)} cy={y(last.cumulative)} r={3} className="msc-cum-dot" />
        <text x={PAD_L} y={H - 6} fontSize={9} className="mono msc-cum-axis">
          {formatMonth(first.month)}
        </text>
        {n > 1 && (
          <text x={W - PAD_R} y={H - 6} fontSize={9} textAnchor="end" className="mono msc-cum-axis">
            {formatMonth(last.month)}
          </text>
        )}
        {/* One hover column per month: a figure appears above the chart. */}
        {points.map((p, i) => {
          const left = i === 0 ? PAD_L : (x(i - 1) + x(i)) / 2;
          const right = i === n - 1 ? W - PAD_R : (x(i) + x(i + 1)) / 2;
          const anchor = i < n / 3 ? "start" : i > (2 * n) / 3 ? "end" : "middle";
          return (
            <g key={p.month} className="msc-cum-col">
              <rect x={left} y={0} width={right - left} height={H} fill="transparent" />
              <circle cx={x(i)} cy={y(p.cumulative)} r={3} className="msc-cum-dot msc-cum-hover" />
              <text x={x(i)} y={12} fontSize={9} textAnchor={anchor} className="mono msc-cum-pill msc-cum-hover">
                {`${formatMonth(p.month)} · ${formatUsd(p.cumulative, true)} cumulative (${formatUsd(p.sky, true)} that month)`}
              </text>
            </g>
          );
        })}
      </svg>
    </Link>
  );
}
