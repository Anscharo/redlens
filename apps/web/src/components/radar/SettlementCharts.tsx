import {
  skyTotal,
  supplyKeptTotal,
  demandSideTotal,
  formatUsd,
  summaryThreeWay,
  activeDemandSeries,
  type SettlementReport,
} from "../../lib/settlements";
import { SettlementBars, type CyclePaging } from "./SettlementBars";
import { SettlementDemandBars } from "./SettlementDemandBars";

export interface SettlementChartsProps {
  reports: SettlementReport[];
  selected: string;
  onSelect: (month: string) => void;
  /** Prime display name, used in “Total {name} retained revenue”. */
  name: string;
  paging?: CyclePaging;
}

const TITLE = "mono text-[10px] uppercase tracking-wider mb-2";

export function SettlementCharts({ reports, selected, onSelect, name, paging }: SettlementChartsProps) {
  const n = reports.length;
  // All three sides of the window, reported separately and never summed.
  const sky = skyTotal(reports);
  const supply = supplyKeptTotal(reports);
  const demand = demandSideTotal(reports);
  const series = activeDemandSeries(reports);
  return (
    <section className="msc-card rounded p-4 mb-4" aria-labelledby="msc-charts-heading">
      <header className="msc-charts-meta">
        <h2
          id="msc-charts-heading"
          className="text-sm font-medium m-0"
          style={{ color: "var(--tan)" }}
        >
          Trailing {n} {n === 1 ? "Month" : "Months"}
          {" – "}
          {name} sent <span className="mono">{formatUsd(sky)}</span> to Sky,
          {" "}kept <span className="mono">{formatUsd(supply)}</span> supply-side,
          {" "}earned <span className="mono">{formatUsd(demand)}</span> demand-side
        </h2>
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
      </header>
      <div className="msc-charts-row">
        <div className="msc-charts-pane">
          <h3 className={TITLE} style={{ color: "var(--tan-3)" }}>
            monthly summary
          </h3>
          <p className="msc-charts-legend mono text-[10px]" style={{ color: "var(--tan-3)" }}>
            <LegendSwatch barClass="msc-bar-sky" label="to Sky" />
            <LegendSwatch barClass="msc-bar-prime" label="supply-side kept" />
            <LegendSwatch barClass="msc-bar-demand" label="demand-side" />
          </p>
          <SettlementBars months={reports.map(summaryThreeWay)} selected={selected} onSelect={onSelect} />
        </div>
        {series.length > 0 && (
          <div className="msc-charts-pane">
            <h3 className={TITLE} style={{ color: "var(--tan-3)" }}>
              demand side
            </h3>
            <p className="msc-charts-legend mono text-[10px]" style={{ color: "var(--tan-3)" }}>
              {series.map((s) => (
                <LegendSwatch key={s.key} barClass={s.barClass} label={s.label.toLowerCase()} />
              ))}
            </p>
            <SettlementDemandBars reports={reports} series={series} selected={selected} onSelect={onSelect} />
          </div>
        )}
      </div>
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
