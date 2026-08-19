import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  loadSettlements,
  reportsForPrime,
  formatUsd,
  revenueGap,
  summaryThreeWay,
  activeDemandSeries,
  headlineFigures,
} from "../../lib/settlements";
import { SettlementBars } from "./SettlementBars";
import { SettlementDemandBars } from "./SettlementDemandBars";
import { ActorSettlementVenues } from "./ActorSettlementVenues";

const mscCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";

interface Props {
  slug: string;
  name: string;
}

export function ActorSettlements({ slug, name }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const reports = useMemo(
    () => (bundle ? reportsForPrime(bundle, slug) : []),
    [bundle, slug],
  );
  const months = reports.map((r) => r.month);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;
  const report = reports.find((r) => r.month === month) ?? null;
  const demandSeries = useMemo(() => activeDemandSeries(reports), [reports]);

  if (!bundle) return null;
  if (!report || !month) {
    return (
      <p className="text-sm italic" style={{ color: "var(--tan-3)" }}>
        No published Monthly Settlement Cycle workbooks for {name}.
      </p>
    );
  }

  const gap = revenueGap(report);
  const workbook = `${SOURCE}/tree/main/reports/${report.prime}/${month}`;
  const selectMonth = (m: string) => setMsc(m === latest ? null : m);

  return (
    <>
      <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
        From Soter Labs' published Monthly Settlement Cycle workbooks — OEA
        calculations, not the on-chain GovOps spell.{" "}
        <a href={workbook} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          {month} source
        </a>
      </p>
      <SettlementBars
        months={reports.map(summaryThreeWay)}
        selected={month}
        onSelect={selectMonth}
      />
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 text-sm">
        {headlineFigures(report).map((f) => (
          <Figure key={f.label} label={f.label} value={f.value} />
        ))}
      </div>
      {gap > 1 && (
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          Headline prime-agent revenue is {formatUsd(gap)} above the venue rows
          (unattributed to any venue).
        </p>
      )}
      <SettlementDemandBars
        reports={reports}
        series={demandSeries}
        selected={month}
        onSelect={selectMonth}
      />
      <ActorSettlementVenues report={report} name={name} />
    </>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
        {label}
      </div>
      <div
        className="mono text-lg"
        style={{ color: value < 0 ? "var(--accent)" : "var(--tan)" }}
      >
        {formatUsd(value)}
      </div>
    </div>
  );
}
