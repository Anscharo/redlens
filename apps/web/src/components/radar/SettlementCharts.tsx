import {
  agentEarningsTotal,
  formatUsd,
  summaryThreeWay,
  activeDemandSeries,
  type SettlementReport,
} from "../../lib/settlements";
import { SettlementBars, type CyclePaging } from "./SettlementBars";
import { SettlementDemandBars } from "./SettlementDemandBars";

interface Props {
  reports: SettlementReport[];
  selected: string;
  onSelect: (month: string) => void;
  paging?: CyclePaging;
}

export function SettlementCharts({ reports, selected, onSelect, paging }: Props) {
  const n = reports.length;
  const earnings = agentEarningsTotal(reports);
  const series = activeDemandSeries(reports);
  return (
    <section className="msc-card rounded p-4 mb-4" aria-labelledby="msc-charts-heading">
      <h2
        id="msc-charts-heading"
        className="mono text-[10px] uppercase tracking-wider mb-2 flex items-center gap-2"
        style={{ color: "var(--tan-3)" }}
      >
        monthly summary
        {paging && (
          <span className="msc-cycle-paging" role="group" aria-label="Cycles shown">
            <button type="button" onClick={paging.onEarlier} disabled={!paging.earlier} aria-label="Earlier cycles">
              ‹
            </button>
            <button type="button" onClick={paging.onLater} disabled={!paging.later} aria-label="Later cycles">
              ›
            </button>
          </span>
        )}
      </h2>
      <div className="msc-charts-meta">
        <h3 className="text-sm font-medium m-0" style={{ color: "var(--tan)" }}>
          Trailing {n} Months
        </h3>
        <p className="m-0 text-sm" style={{ color: "var(--tan-2)" }}>
          Agent earnings{" "}
          <span className="mono" style={{ color: "var(--tan)" }}>
            {formatUsd(earnings)}
          </span>
        </p>
      </div>
      <p className="msc-charts-legend mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        <LegendSwatch barClass="msc-bar-sky" label="to Sky" />
        <LegendSwatch barClass="msc-bar-prime" label="supply-side kept" />
        <LegendSwatch barClass="msc-bar-demand" label="demand-side" />
        {series.length > 0 && (
          <>
            <span className="msc-legend-sep" aria-hidden="true">
              |
            </span>
            {series.map((s) => (
              <LegendSwatch key={s.key} barClass={s.barClass} label={s.label.toLowerCase()} />
            ))}
          </>
        )}
      </p>
      <SettlementBars months={reports.map(summaryThreeWay)} selected={selected} onSelect={onSelect} />
      <SettlementDemandBars reports={reports} series={series} selected={selected} onSelect={onSelect} />
    </section>
  );
}

function LegendSwatch({ barClass, label }: { barClass: string; label: string }) {
  return (
    <span>
      <span className={`${barClass} inline-block w-2 h-2 mr-1 align-middle`} /> {label}
    </span>
  );
}
