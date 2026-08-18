import { formatMonth, formatUsd } from "../../lib/settlements";

export interface MonthBar {
  month: string;
  sky: number;
  prime: number;
}

export function SettlementBars({
  months,
  selected,
  onSelect,
}: {
  months: MonthBar[];
  selected: string;
  onSelect: (month: string) => void;
}) {
  const peak = Math.max(1, ...months.map((m) => Math.abs(m.sky) + Math.abs(m.prime)));
  return (
    <div>
      <div className="flex items-end gap-3 mb-2" role="group" aria-label="Settlement months">
        {months.map((m) => {
          const skyPct = (Math.abs(m.sky) / peak) * 100;
          const primePct = (Math.abs(m.prime) / peak) * 100;
          return (
            <button
              key={m.month}
              type="button"
              className="msc-bar-col"
              data-active={m.month === selected ? "true" : undefined}
              onClick={() => onSelect(m.month)}
              aria-pressed={m.month === selected}
              aria-label={`${formatMonth(m.month)}: ${formatUsd(m.sky, true)} to Sky, ${formatUsd(m.prime, true)} kept`}
            >
              <span className="msc-bar-track" aria-hidden="true">
                <span className="msc-bar-sky" style={{ height: `${skyPct}%` }} />
                <span className="msc-bar-prime" style={{ height: `${primePct}%` }} />
              </span>
              <span className="mono text-[10px]">{formatMonth(m.month)}</span>
            </button>
          );
        })}
      </div>
      <p className="mono text-[10px] mb-5 flex gap-4" style={{ color: "var(--tan-3)" }}>
        <span><span className="msc-bar-sky inline-block w-2 h-2 mr-1 align-middle" /> to Sky</span>
        <span><span className="msc-bar-prime inline-block w-2 h-2 mr-1 align-middle" /> kept by agent</span>
      </p>
    </div>
  );
}
