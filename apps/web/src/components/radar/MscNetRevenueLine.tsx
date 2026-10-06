import { formatMonth, formatUsd, formatUsdShort } from "../../lib/settlements";

/** Sky's Net Revenue as a line over the To-Sky columns: one dot per month
 *  that has a figure, its amount beside it, joined only between consecutive
 *  months, so a month without one breaks the line rather than being
 *  bridged. */
export function MscNetRevenueLine({ months, values, tops, x, y, width, height }: {
  months: string[];
  values: Map<string, number>;
  /** Each month's stack top (Σ positive To Sky), whose own total label
   *  floats just above it: a Net Revenue amount goes on the other side of
   *  its dot from that label. */
  tops: number[];
  /** Centre x of month column i, in the chart's coordinates. */
  x: (i: number) => number;
  y: (v: number) => number;
  width: number;
  height: number;
}) {
  const pts = months.map((m, i) => (values.has(m) ? { m, i, v: values.get(m)! } : null));
  const segs = pts.slice(1).flatMap((p, k) => (p && pts[k] ? [[pts[k]!, p]] : []));
  return (
    <svg className="msc-ts-netrev" width={width} height={height} aria-label="Sky Net Revenue by month">
      {segs.map(([a, b]) => (
        <line key={a.m} x1={x(a.i)} y1={y(a.v)} x2={x(b.i)} y2={y(b.v)} className="msc-ts-netrev-line" />
      ))}
      {pts.map((p) => p && (
        <g key={p.m}>
          <circle cx={x(p.i)} cy={y(p.v)} r={4} className="msc-ts-netrev-dot">
            <title>{`Sky Net Revenue · ${formatMonth(p.m)} · ${formatUsd(p.v)} (Soter Labs consolidated report)`}</title>
          </circle>
          <text x={x(p.i)} y={y(p.v) + (p.v > tops[p.i] ? -9 : 16)} textAnchor="middle" fontSize={10} className="mono msc-ts-netrev-amount">
            {formatUsdShort(p.v, 100_000)}
          </text>
        </g>
      ))}
    </svg>
  );
}
