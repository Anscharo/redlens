import { useMemo } from "react";
import { loadDocs } from "@/lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUTCDay } from "../../hooks/useUTCDay";
import { buildStaleDatesReport, staleDatesToCSV, DUE_SOON_DAYS } from "@/lib/staleDates";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { ReportShell } from "./ReportShell";
import { StaleDatesSection } from "./StaleDatesSection";
import { useReportQuery } from "./useReportQuery";
import { staleSearchFields, STALE_SEARCHES } from "./staleDatesSearch";

const REPORT: ReportId = "stale-dates";

const SECTIONS: {
  key: "upcoming" | "dueSoon" | "stale";
  title: string;
  hint: string;
  tone: string;
  textTone?: string; // heading text when the bar tone is too dark to read on --bg
}[] = [
  {
    key: "upcoming",
    title: "Upcoming",
    hint: "The atlas's live calendar — future claims with dates still ahead.",
    tone: "var(--accent)",
  },
  {
    key: "dueSoon",
    title: `Due within ${DUE_SOON_DAYS} days`,
    hint: "Future claims about to cross today — stale soon unless the atlas is updated.",
    tone: "var(--warn)",
  },
  {
    key: "stale",
    title: "Stale",
    hint: "The date has passed but the atlas still phrases the event as future.",
    tone: "var(--red)", // left bar only — keeps the selected-node idiom
    textTone: "var(--error-text)", // --red is below 3:1 on --bg; use the accessible alias
  },
];

export function StaleDatesReport({ query, mode }: { query: string; mode: ReportMode }) {
  // A load failure re-throws out of useLoaded into the route's ErrorBoundary,
  // which owns the error + retry UI for every page (the report used to carry
  // its own copy).
  const docs = useLoaded(loadDocs);
  const day = useUTCDay();

  // Recomputed from the loaded atlas + the current UTC day — no build step
  // involved, and the day-keyed memo re-buckets a tab left open past midnight.
  const report = useMemo(
    () => (docs ? buildStaleDatesReport(docs, new Date(`${day}T12:00:00Z`)) : null),
    [docs, day],
  );

  // Text filter applies within each bucket; buckets keep their order/heading.
  const rq = useReportQuery(query, mode);
  const sections = useMemo(
    () =>
      report ? SECTIONS.map((s) => ({ ...s, claims: filterRows(report[s.key], rq, staleSearchFields) })) : null,
    [report, rq],
  );
  const anyShown = sections?.some((s) => s.claims.length > 0) ?? false;

  // The CSV exports what's on screen — the filtered buckets, not the full scan
  // — so a downloaded file matches the active query (totalDateMentions is the
  // scan tally and stays informational).
  const csvReport = useMemo(() => {
    if (!report || !sections) return null;
    const claimsFor = (key: (typeof SECTIONS)[number]["key"]) =>
      [...(sections.find((s) => s.key === key)?.claims ?? [])];
    return { ...report, upcoming: claimsFor("upcoming"), dueSoon: claimsFor("dueSoon"), stale: claimsFor("stale") };
  }, [report, sections]);

  return (
    <ReportShell
      report={REPORT}
      title="Stale Dates"
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
        csvReport && report ? (
          <DownloadCsvButton
            report={REPORT}
            filename="stale-dates.csv"
            rowCount={csvReport.stale.length + csvReport.dueSoon.length + csvReport.upcoming.length}
            build={() => staleDatesToCSV(csvReport)}
            fullRowCount={report.stale.length + report.dueSoon.length + report.upcoming.length}
            buildFull={() => staleDatesToCSV(report)}
            query={query}
          />
        ) : undefined
      }
      loading={!report || !sections}
      viewProps={{ row_count: report?.totalDateMentions ?? 0 }}
      noRows={!anyShown && !!query.trim()}
    >
      {/* A query that clears every bucket shows only the no-rows line — not
          three empty section headings. */}
      {(anyShown || !query.trim()) &&
        sections?.map((s) => (
          <StaleDatesSection
            key={s.key}
            title={s.title}
            hint={s.hint}
            claims={s.claims}
            tone={s.tone}
            textTone={s.textTone}
            rq={rq}
          />
        ))}
    </ReportShell>
  );
}
