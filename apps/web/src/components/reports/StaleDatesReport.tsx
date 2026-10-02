import { staleDatesToCSV, type StaleDatesReport as StaleDates } from "@/lib/staleDates";
import { type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ReportShell } from "./ReportShell";
import { StaleDatesSection } from "./StaleDatesSection";
import { STALE_SEARCHES } from "@/lib/staleDatesSearch";
import { useStaleDatesState } from "./useStaleDatesState";

const REPORT: ReportId = "stale-dates";

const claimCount = (r: StaleDates) => r.stale.length + r.dueSoon.length + r.upcoming.length;

/** `csvReport` is the on-screen (filtered) buckets; `report` is the full scan. */
function StaleDatesCsvButton({ csvReport, report, query }: { csvReport: StaleDates; report: StaleDates; query: string }) {
  return (
    <DownloadCsvButton
      report={REPORT}
      filename="stale-dates.csv"
      rowCount={claimCount(csvReport)}
      build={() => staleDatesToCSV(csvReport)}
      fullRowCount={claimCount(report)}
      buildFull={() => staleDatesToCSV(report)}
      query={query}
    />
  );
}

export function StaleDatesReport({ query, mode }: { query: string; mode: ReportMode }) {
  const { report, rq, sections, csvReport, anyShown } = useStaleDatesState(query, mode);
  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-4xl"
      description={
        <>
          Future-tense claims in atlas prose ("will be included in the … Executive Vote") checked against
          today's date. An overdue claim means the event happened and the text was never updated — or it
          slipped.
          {report && <span className="mono"> {report.totalDateMentions} dated mentions scanned.</span>}
        </>
      }
      query={query}
      searches={STALE_SEARCHES}
      actions={
        csvReport && report ? <StaleDatesCsvButton csvReport={csvReport} report={report} query={query} /> : undefined
      }
      loading={!report || !sections}
      viewProps={{ row_count: report?.totalDateMentions ?? 0 }}
      noRows={!anyShown && !!query.trim()}
    >
      {/* A query that clears every bucket shows only the no-rows line — not
          three empty section headings. */}
      {(anyShown || !query.trim()) &&
        sections?.map(({ key, ...section }) => <StaleDatesSection key={key} {...section} rq={rq} />)}
    </ReportShell>
  );
}
