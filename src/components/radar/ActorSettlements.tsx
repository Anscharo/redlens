import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, urlString } from "../../hooks/useUrlState";
import {
  loadSettlements,
  reportsForPrime,
  formatUsd,
  revenueGap,
} from "../../lib/settlements";
import { HEADER_OFFSET } from "../../lib/layout";
import { SettlementBars } from "./SettlementBars";
import { SettlementSankey, SettlementVenueTable } from "./SettlementSankey";

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

  if (!bundle || !report || !month) return null;

  const gap = revenueGap(report);
  const hasVenues = report.venues.some(
    (v) => Math.abs(v.profitToSky) + Math.abs(v.profitToGrove) >= 1,
  );
  const workbook = `${SOURCE}/tree/main/reports/${slug}/${month}`;

  return (
    <section id="msc" className="mb-8" style={{ scrollMarginTop: HEADER_OFFSET }}>
      <h2
        className="mono text-[10px] uppercase tracking-wider mb-3"
        style={{ color: "var(--tan-3)" }}
      >
        Monthly settlement
      </h2>
      <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
        From Soter Labs' published Monthly Settlement Cycle workbooks — OEA
        calculations, not the on-chain GovOps spell.{" "}
        <a href={workbook} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          {month} source
        </a>
      </p>
      <SettlementBars
        months={reports.map((r) => ({
          month: r.month,
          sky: r.headline.skyRevenue,
          prime: r.headline.profitToGrove,
        }))}
        selected={month}
        onSelect={(m) => setMsc(m === latest ? null : m)}
      />
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 text-sm">
        <Figure label="To Sky" value={report.headline.skyRevenue} />
        <Figure label={`Kept by ${name}`} value={report.headline.profitToGrove} />
        <Figure label="Cost of funds" value={report.headline.cof} />
      </div>
      {gap > 1 && (
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          Headline prime-agent revenue is {formatUsd(gap)} above the venue rows
          (unattributed to any venue).
        </p>
      )}
      {hasVenues ? (
        <>
          <SettlementSankey venues={report.venues} primeLabel={name} />
          <SettlementVenueTable venues={report.venues} primeLabel={name} />
        </>
      ) : (
        <p className="text-sm italic" style={{ color: "var(--tan-3)" }}>
          Published workbooks list no venue-level PnL for {name}.
        </p>
      )}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
        {label}
      </div>
      <div className="mono text-lg" style={{ color: "var(--tan)" }}>{formatUsd(value)}</div>
    </div>
  );
}
