// CSV export for the OEA Task Assessment report. A collapsed task expands to
// one CSV row per copy, so the counts come from oeaCsvRowCount, not rows.length.
import { oeaRowsToCSV, oeaCsvRowCount, type OeaRow } from "@/lib/oeaReport";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";

export function OeaAssessmentCsvButton({
  report,
  rows,
  shown,
  query,
  filters,
}: {
  report: ReportId;
  rows: readonly OeaRow[];
  shown: readonly OeaRow[];
  query: string;
  filters: (string | null)[];
}) {
  return (
    <DownloadCsvButton
      report={report}
      filename="oea-task-assessment.csv"
      rowCount={oeaCsvRowCount(shown)}
      build={() => oeaRowsToCSV(shown)}
      fullRowCount={oeaCsvRowCount(rows)}
      buildFull={() => oeaRowsToCSV(rows)}
      query={query}
      filters={filters}
    />
  );
}
