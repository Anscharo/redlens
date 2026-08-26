import {
  formatMonth,
  formatUsd,
  demandPart,
  type DemandKey,
  type SettlementReport,
} from "../../lib/settlements";

type Series = { key: DemandKey; label: string; barClass: string };

export function SettlementDemandBars({
  reports,
  series,
  selected,
  onSelect,
}: {
  reports: SettlementReport[];
  series: readonly Series[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  if (series.length === 0) return null;
  const peak = Math.max(
    1,
    ...reports.map((r) => series.reduce((n, s) => n + Math.abs(demandPart(r.headline, s.key)), 0)),
  );
  return (
    <div className="mb-5">
      <p className="mono text-[10px] uppercase tracking-wider mb-2" style={{ color: "var(--tan-3)" }}>
        Demand-side
      </p>
      <div className="flex items-end gap-3 mb-2" role="group" aria-label="Demand-side months">
        {reports.map((r) => {
          const parts = series.map((s) => ({ ...s, value: demandPart(r.headline, s.key) }));
          const label = parts
            .filter((p) => Math.abs(p.value) >= 1)
            .map((p) => `${formatUsd(p.value, true)} ${p.label.toLowerCase()}`)
            .join(", ");
          return (
            <button
              key={r.month}
              type="button"
              className="msc-bar-col"
              data-active={r.month === selected ? "true" : undefined}
              onClick={() => onSelect(r.month)}
              aria-pressed={r.month === selected}
              aria-label={`${formatMonth(r.month)}: ${label || "$0 demand-side"}`}
            >
              <span className="msc-bar-stack" aria-hidden="true">
                {parts.map((p) => {
                  const h = (Math.abs(p.value) / peak) * 100;
                  if (h < 0.4) return null;
                  return <span key={p.key} className={p.barClass} style={{ flex: `0 0 ${h}%` }} />;
                })}
              </span>
              <span className="mono text-[10px]">{formatMonth(r.month)}</span>
            </button>
          );
        })}
      </div>
      <p className="mono text-[10px] flex flex-wrap gap-x-4 gap-y-1" style={{ color: "var(--tan-3)" }}>
        {series.map((s) => (
          <span key={s.key}>
            <span className={`${s.barClass} inline-block w-2 h-2 mr-1 align-middle`} /> {s.label.toLowerCase()}
          </span>
        ))}
      </p>
    </div>
  );
}
