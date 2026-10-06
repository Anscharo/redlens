import { formatMonth, formatUsd } from "../../lib/settlements";

/** Sky's Net Revenue as a line over the To-Sky columns: one dot per month
 *  that has a figure, joined only between consecutive months, so a month
 *  without one breaks the line rather than being bridged. */
export function MscNetRevenueLine({ months, values, x, y, width, height }: {
  months: string[];
  values: Map<string, number>;
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
        <circle key={p.m} cx={x(p.i)} cy={y(p.v)} r={4} className="msc-ts-netrev-dot">
          <title>{`Sky Net Revenue · ${formatMonth(p.m)} · ${formatUsd(p.v)} (Soter Labs consolidated report)`}</title>
        </circle>
      ))}
    </svg>
  );
}
