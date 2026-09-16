import {
  formatMonth,
  formatUsd,
  demandPart,
  type DemandKey,
  type SettlementReport,
} from "../../lib/settlements";
import { Tooltip } from "../Tooltip";
import { MscMonthLabel } from "./MscMonthLabel";

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
  const keys = reports.map((r) => r.month);
  return (
    <div>
      <div className="flex items-end gap-3 mb-2" role="group" aria-label="Demand-side months">
        {reports.map((r, i) => {
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
                  return (
                    // delay={0}: the segment is the whole point of this chart —
                    // the amount should appear the instant the pointer lands,
                    // not after the 200ms app default used elsewhere.
                    <Tooltip key={p.key} delay={0} content={`${p.label} ${formatUsd(p.value)}`}>
                      <span className={p.barClass} style={{ flex: `0 0 ${h}%` }} />
                    </Tooltip>
                  );
                })}
              </span>
              <MscMonthLabel months={keys} index={i} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
