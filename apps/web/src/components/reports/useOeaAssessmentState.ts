// Data/filter-state hooks backing OeaAssessmentReport.tsx: the URL-synced
// category/rating/status pills, the loaded report, the filtered rows grouped
// by category, and the expanded-row state.
import { useMemo } from "react";
import { useLoaded } from "../../hooks/useAtlasData";
import { OEA_CATEGORY_LABELS, type OeaCategory } from "@/lib/oeaTasks";
import type { Rating } from "@/lib/oeaAssessment";
import { oeaSearchFields, type OeaReportArtifact, type OeaRow, type OeaRowStatus } from "@/lib/oeaReport";
import { loadOeaReport } from "../../lib/oeaReportLoad";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { categoryCodec } from "./CategoryPills";
import { RATING_LABELS, STATUS_LABELS } from "./OeaAssessmentControls";
import { useExpandedRow } from "./useExpandedRow";
import { useReportFilter, useReportQuery } from "./useReportQuery";

const catCodec = categoryCodec(OEA_CATEGORY_LABELS);
const ratingCodec = categoryCodec(RATING_LABELS);
const statusCodec = categoryCodec(STATUS_LABELS);

// The four pill filters, shaped as OeaAssessmentControls' props.
function useOeaPills(report: ReportId) {
  const [cat, onCat] = useReportFilter<OeaCategory>(report, "cat", catCodec, "category");
  const [precision, onPrecision] = useReportFilter<Rating>(report, "precision", ratingCodec);
  const [incentives, onIncentives] = useReportFilter<Rating>(report, "incentives", ratingCodec);
  const [status, onStatus] = useReportFilter<OeaRowStatus>(report, "status", statusCodec);
  return { cat, onCat, precision, onPrecision, incentives, onIncentives, status, onStatus };
}

type OeaPills = ReturnType<typeof useOeaPills>;

function matchesPills(
  r: OeaRow,
  { cat, status, precision, incentives }: Pick<OeaPills, "cat" | "status" | "precision" | "incentives">,
): boolean {
  return (
    (cat === null || r.task.category === cat) &&
    (status === null || r.status === status) &&
    (precision === null || r.entry?.precision.rating === precision) &&
    (incentives === null || r.entry?.incentives.rating === incentives)
  );
}

function filterLabels({ cat, precision, incentives, status }: OeaPills) {
  return [
    cat && OEA_CATEGORY_LABELS[cat],
    precision && `precision:${precision}`,
    incentives && `incentives:${incentives}`,
    status && `status:${status}`,
  ];
}

// Pill-filtered, then text-filtered rows, grouped by category for the tables.
function useOeaRows(rows: OeaRow[], pills: OeaPills, query: string, mode: ReportMode) {
  // Memoized so a parent re-render (e.g. expanding a row) doesn't hand OeaTable
  // a fresh `catRows` array — usePagedRows resets its page on `rows` identity
  // change, which would collapse an expanded row past the first page.
  const { cat, status, precision, incentives } = pills;
  const filtered = useMemo(
    () => rows.filter((r) => matchesPills(r, { cat, status, precision, incentives })),
    [rows, cat, status, precision, incentives],
  );
  const rq = useReportQuery(query, mode);
  const shown = useMemo(() => filterRows(filtered, rq, oeaSearchFields), [filtered, rq]);
  const byCategory = useMemo(
    () => Object.groupBy(shown, (r) => r.task.category) as Record<OeaCategory, OeaRow[]>,
    [shown],
  );
  return { shown, byCategory, rq };
}

function viewPropsOf(report: OeaReportArtifact | null) {
  return {
    row_count: report?.rows.length ?? 0,
    stale_count: report?.summary.stale ?? 0,
    unassessed_count: report?.summary.unassessed ?? 0,
    rubric_version: report?.rubricVersion ?? null,
  };
}

export function useOeaAssessmentState(report: ReportId, introDocUuid: string, query: string, mode: ReportMode) {
  const loaded = useLoaded(loadOeaReport);
  const pills = useOeaPills(report);
  const [expanded, toggleExpanded] = useExpandedRow(report);
  const rows = useMemo(() => loaded?.rows ?? [], [loaded]);
  const toggleRow = (row: OeaRow) =>
    toggleExpanded(row.task.taskKey, { node_id: row.task.uuid, category: row.task.category, status: row.status });
  const { shown, byCategory, rq } = useOeaRows(rows, pills, query, mode);
  const table = { byCategory, expandedKey: expanded, onToggle: toggleRow, rq };
  const filters = {
    labels: filterLabels(pills),
    csv: [pills.cat, pills.status, pills.precision, pills.incentives],
  };
  const introDocNo = rows.find((r) => r.task.uuid === introDocUuid)?.task.docNo;
  return { report: loaded, rows, shown, pills, filters, table, introDocNo, viewProps: viewPropsOf(loaded) };
}
