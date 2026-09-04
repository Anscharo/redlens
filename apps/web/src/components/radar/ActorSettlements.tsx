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
  demandSideRevenue,
  supplyKept,
  settlementsArtifactMissing,
} from "../../lib/settlements";
import { loadForumTopics } from "../../lib/forumTopics";
import { forumTopicUrlForMonth } from "@/lib/forumMonths";
import { primeRoster } from "@/lib/settlementsOverview";
import { SettlementBars } from "./SettlementBars";
import { SettlementDemandBars } from "./SettlementDemandBars";
import { ActorSettlementVenues } from "./ActorSettlementVenues";
import { MscHeadline } from "./MscHeadline";
import { primeFill } from "./MscTimeseries";

const mscCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";

interface Props {
  slug: string;
  name: string;
}

export function ActorSettlements({ slug, name }: Props) {
  const bundle = useLoaded(loadSettlements, { soft: true });
  const topics = useLoaded(loadForumTopics, { soft: true });
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
  if (settlementsArtifactMissing(bundle)) {
    return (
      <p className="text-sm italic" style={{ color: "var(--tan-3)" }}>
        Settlement figures could not be loaded.
      </p>
    );
  }
  if (!report || !month) {
    return (
      <p className="text-sm italic" style={{ color: "var(--tan-3)" }}>
        No published Monthly Settlement Cycle workbooks for {name}.
      </p>
    );
  }

  const gap = revenueGap(report);
  // The Prime's identity color: the same roster index the overview uses for
  // its ring rim and timeseries layer, so the two pages agree on who is who.
  const color = primeFill(primeRoster(bundle).indexOf(report.prime));
  const workbook = `${SOURCE}/tree/main/reports/${report.prime}/${month}`;
  const forumUrl = forumTopicUrlForMonth(topics ?? [], month);
  const selectMonth = (m: string) => setMsc(m === latest ? null : m);

  return (
    <>
      <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
        From Soter Labs' published Monthly Settlement Cycle workbooks — OEA
        calculations, not the on-chain GovOps spell and not Sky Atlas figures.
        “To Sky” is what this Prime owed Sky, not the Protocol’s Net Revenue,
        which the Atlas defines as income minus expenses (A.2.3.1.2.1.1).{" "}
        <a href={workbook} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          {month} source
        </a>
        {forumUrl && (
          <>
            {" · "}
            <a href={forumUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Sky Forum
            </a>
          </>
        )}
      </p>
      <SettlementBars
        months={reports.map(summaryThreeWay)}
        selected={month}
        onSelect={selectMonth}
      />
      <MscHeadline
        eco={{
          sky: report.headline.skyRevenue,
          cof: report.headline.cof,
          sde: report.headline.sdeRevenue,
          kept: supplyKept(report),
          demand: demandSideRevenue(report.headline),
        }}
        labels={{ kept: "Supply kept", demand: "Demand-side" }}
        identity={{ label: name, color }}
      />
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
      <ActorSettlementVenues report={report} name={name} primeColor={color} />
    </>
  );
}
