import { Suspense, use, useMemo, useState } from "react";
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
  cycleWindow,
  windowOffsetFor,
  CYCLE_WINDOW,
} from "../../lib/settlements";
import { loadForumTopics } from "../../lib/forumTopics";
import { forumTopicUrlForMonth } from "@/lib/forumMonths";
import { SettlementBars } from "./SettlementBars";
import { SettlementDemandBars } from "./SettlementDemandBars";
import { ActorSettlementVenues } from "./ActorSettlementVenues";
import { MscHeadline } from "./MscHeadline";
import { ActorSettlementsSkeleton } from "./ActorSettlementsSkeleton";
import { useMonthAutoplay } from "../../hooks/useMonthAutoplay";

const mscCodec = urlString(null);
const SOURCE = "https://github.com/soterlabs/settlement-reports";
/** Autoplay dwell here: the venue Sankey's transition (SETTLE_TWEEN_MS,
 *  ActorSettlementVenues) is slow enough to follow, and a month should
 *  settle and be read before the next one starts. */
const SETTLE_PLAY_MS = 2400;

interface Props {
  slug: string;
  name: string;
}

/** A Prime's Monthly Settlement Cycle charts. Suspends on the settlements
 *  artifact behind a skeleton of the same chrome at the same sizes
 *  (ActorSettlementsSkeleton), so the charts paint into place. */
export function ActorSettlements(props: Props) {
  return (
    <Suspense fallback={<ActorSettlementsSkeleton />}>
      <ActorSettlementsLoaded {...props} />
    </Suspense>
  );
}

function ActorSettlementsLoaded({ slug, name }: Props) {
  const bundle = use(loadSettlements());
  const topics = useLoaded(loadForumTopics, { soft: true });
  const reports = useMemo(() => reportsForPrime(bundle, slug), [bundle, slug]);
  const months = reports.map((r) => r.month);
  const latest = months[months.length - 1] ?? null;
  const [msc, setMsc] = useUrlState("msc", mscCodec);
  const month = months.includes(msc ?? "") ? msc! : latest;
  const play = useMonthAutoplay(months, month, latest, setMsc, SETTLE_PLAY_MS);
  const report = reports.find((r) => r.month === month) ?? null;
  // The bar charts show a year of cycles at a time. The arrows page that
  // window (and may page the selected month off screen); when the SELECTION
  // moves (click, keys, autoplay), the window follows it into view. The
  // page remembers which month it was set for, so the two never fight.
  const [page, setPage] = useState({ month, offset: 0 });
  const offset = page.month === month
    ? page.offset
    : windowOffsetFor(months.length, page.offset, months.indexOf(month ?? ""));
  const shown = cycleWindow(reports, offset);
  const paging = months.length > CYCLE_WINDOW
    ? {
        earlier: shown.earlier,
        later: shown.later,
        onEarlier: () => setPage({ month, offset: offset + CYCLE_WINDOW }),
        onLater: () => setPage({ month, offset: Math.max(0, offset - CYCLE_WINDOW) }),
      }
    : undefined;
  const demandSeries = useMemo(() => activeDemandSeries(reports), [reports]);

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
  const workbook = `${SOURCE}/tree/main/reports/${report.prime}/${month}`;
  const forumUrl = forumTopicUrlForMonth(topics ?? [], month);
  const selectMonth = (m: string) => {
    play.pause();
    setMsc(m === latest ? null : m);
  };

  return (
    <>
      <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
        Soter Labs' Monthly Settlement Cycle workbooks (OEA calculations, not
        Atlas figures). “To Sky” is what this Prime owed Sky, not the Protocol’s
        Net Revenue (A.2.3.1.2.1.1).{" "}
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
      {/* One card of month charts — the Summary, then the demand-side mix
          under it with its columns on the same grid — above the month's
          figures. */}
      <div className="msc-card rounded p-4 mb-4">
        <SettlementBars
          months={shown.rows.map(summaryThreeWay)}
          selected={month}
          onSelect={selectMonth}
          paging={paging}
        />
        <SettlementDemandBars
          reports={shown.rows}
          series={demandSeries}
          selected={month}
          onSelect={selectMonth}
        />
      </div>
      <MscHeadline
        eco={{
          sky: report.headline.skyRevenue,
          cof: report.headline.cof,
          sde: report.headline.sdeRevenue,
          kept: supplyKept(report),
          demand: demandSideRevenue(report.headline),
        }}
        month={month}
        play={{ playing: play.playing, onToggle: play.toggle }}
        labels={{ kept: "Supply-side kept", demand: "Demand-side" }}
      />
      {gap > 1 && (
        <p className="text-xs mb-3" style={{ color: "var(--tan-3)" }}>
          Headline prime-agent revenue is {formatUsd(gap)} above the venue rows
          (unattributed to any venue).
        </p>
      )}
      <ActorSettlementVenues report={report} name={name} />
    </>
  );
}
