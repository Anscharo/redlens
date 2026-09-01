import { formatUsd, type HeadlineFigure } from "../../lib/settlements";

/** One headline figure. `component: true` rows are a breakdown of the figure
 *  above them (e.g. "of which cost of funds" under "To Sky") and render
 *  smaller and muted so nobody adds them to their parent. */
export function SettlementFigure({ label, value, component }: HeadlineFigure) {
  return (
    <div>
      <div className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
        {label}
      </div>
      <div
        className={component ? "mono text-sm" : "mono text-lg"}
        style={{
          color: component ? "var(--tan-3)" : value < 0 ? "var(--accent)" : "var(--tan)",
        }}
      >
        {formatUsd(value)}
      </div>
    </div>
  );
}
