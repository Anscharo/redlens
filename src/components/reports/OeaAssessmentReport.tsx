import { useMemo } from "react";
import { AtlasLink } from "../AtlasLink";
import { useLoaded } from "../../hooks/useAtlasData";
import { atlasHref } from "@/lib/routes";
import { OEA_CATEGORY_LABELS, type OeaCategory } from "@/lib/oeaTasks";
import type { Rating } from "@/lib/oeaAssessment";
import { oeaRowsToCSV, oeaCsvRowCount, type OeaRow, type OeaRowStatus } from "@/lib/oeaReport";
import { loadOeaReport } from "@/lib/oeaReportLoad";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { categoryCodec } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { OeaTable, oeaSearchFields } from "./OeaAssessmentTable";
import { OeaAssessmentControls, OeaSummaryStrip, RATING_LABELS, STATUS_LABELS } from "./OeaAssessmentControls";
import { ReportShell } from "./ReportShell";
import { useExpandedRow } from "./useExpandedRow";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const REPORT: ReportId = "oea-assessment";
// A.1.14.4.6.1.1 Executor Agent GovOps — the doc_no shown next to the link is
// resolved from the report's own rows (the doc is one of the assessed tasks),
// never hardcoded: doc_nos move on every atlas renumber.
const INTRO_DOC_UUID = "76405733-3740-4c62-836f-c0683840a9a2";

// Header-box text filter over the fields declared in OeaAssessmentTable
// (which also tracks their visibility for the hidden-match aside).
// Category/rating/status facets are pill-owned and excluded; the text
// filter ANDs with the pills.
const SEARCHES = "doc no · title · assessed task text · covered prime agents";
const catCodec = categoryCodec(OEA_CATEGORY_LABELS);
const ratingCodec = categoryCodec(RATING_LABELS);
const statusCodec = categoryCodec(STATUS_LABELS);

export function OeaAssessmentReport({ query, mode }: { query: string; mode: ReportMode }) {
  const report = useLoaded(loadOeaReport);
  const [cat, toggleCat] = useReportFilter<OeaCategory>(REPORT, "cat", catCodec, "category");
  const [precision, togglePrecision] = useReportFilter<Rating>(REPORT, "precision", ratingCodec);
  const [incentives, toggleIncentives] = useReportFilter<Rating>(REPORT, "incentives", ratingCodec);
  const [status, toggleStatus] = useReportFilter<OeaRowStatus>(REPORT, "status", statusCodec);
  const [expanded, toggleExpanded] = useExpandedRow(REPORT);
  const rows = useMemo(() => report?.rows ?? [], [report]);
  const toggleRow = (row: OeaRow) =>
    toggleExpanded(row.task.taskKey, { node_id: row.task.uuid, category: row.task.category, status: row.status });

  // Memoized so a parent re-render (e.g. expanding a row) doesn't hand OeaTable
  // a fresh `catRows` array — usePagedRows resets its page on `rows` identity
  // change, which would collapse an expanded row past the first page.
  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (cat === null || r.task.category === cat) &&
          (status === null || r.status === status) &&
          (precision === null || r.entry?.precision.rating === precision) &&
          (incentives === null || r.entry?.incentives.rating === incentives),
      ),
    [rows, cat, status, precision, incentives],
  );
  const rq = useReportQuery(query, mode);
  const shown = useMemo(() => filterRows(filtered, rq, oeaSearchFields), [filtered, rq]);
  const byCategory = useMemo(
    () => Object.groupBy(shown, (r) => r.task.category) as Record<OeaCategory, OeaRow[]>,
    [shown],
  );
  const introDocNo = rows.find((r) => r.task.uuid === INTRO_DOC_UUID)?.task.docNo;

  return (
    <ReportShell
      report={REPORT}
      title="OEA Task Assessment"
      description={
        <>
          Every task the Operational Executor Agent performs — via its GovOps and Facilitator actors or
          directly — rated for how precisely it is defined and whether it carries incentives or penalties.{" "}
          <AtlasLink to={atlasHref(INTRO_DOC_UUID)} className="text-accent hover:underline">
            {introDocNo ? `${introDocNo} ` : ""}Executor Agent GovOps ↗
          </AtlasLink>
        </>
      }
      note={
        <>
          ✳ assessed by {report?.model ?? "—"} · human-reviewed · rubric {report?.rubricVersion ?? "—"}
        </>
      }
      noteTitle="Ratings are LLM-drafted against the assessment rubric, then human-reviewed. Click a row for the reasoning."
      controls={
        <OeaAssessmentControls
          cat={cat}
          onCat={toggleCat}
          precision={precision}
          onPrecision={togglePrecision}
          incentives={incentives}
          onIncentives={toggleIncentives}
          status={status}
          onStatus={toggleStatus}
        />
      }
      query={query}
      filters={[
        cat && OEA_CATEGORY_LABELS[cat],
        precision && `precision:${precision}`,
        incentives && `incentives:${incentives}`,
        status && `status:${status}`,
      ]}
      searches={SEARCHES}
      count={rows.length > 0 ? <OeaSummaryStrip rows={shown} /> : undefined}
      actions={
        rows.length > 0 ? (
          <DownloadCsvButton
            report={REPORT}
            filename="oea-task-assessment.csv"
            rowCount={oeaCsvRowCount(shown)}
            build={() => oeaRowsToCSV(shown)}
            fullRowCount={oeaCsvRowCount(rows)}
            buildFull={() => oeaRowsToCSV(rows)}
            query={query}
            filters={[cat, status, precision, incentives]}
          />
        ) : undefined
      }
      ready={!!report}
      viewProps={{
        row_count: report?.rows.length ?? 0,
        stale_count: report?.summary.stale ?? 0,
        unassessed_count: report?.summary.unassessed ?? 0,
        rubric_version: report?.rubricVersion ?? null,
      }}
      noRows={rows.length > 0 && shown.length === 0}
    >
      {report &&
        (Object.entries(OEA_CATEGORY_LABELS) as [OeaCategory, string][]).map(([c, label]) => {
          const catRows = byCategory[c];
          if (!catRows?.length) return null;
          return (
            <OeaTable
              key={c}
              label={label}
              rows={catRows}
              mechanisms={report.mechanisms}
              expandedKey={expanded}
              onToggle={toggleRow}
              rq={rq}
            />
          );
        })}
    </ReportShell>
  );
}
