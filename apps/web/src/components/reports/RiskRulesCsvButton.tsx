// CSV export for the Risk Rules Assessment report: the filtered rows, or the
// full row set, with the active pills recorded on the export event.
import { riskRowsToCSV, type RiskRow } from "@/lib/riskAssessmentIndex";
import { DownloadCsvButton } from "./DownloadCsvButton";
import { REPORT, domainLabels, type RiskFilters } from "./useRiskRules";

export function RiskRulesCsvButton({
  rows, filtered, query, filters: f,
}: {
  rows: readonly RiskRow[];
  filtered: readonly RiskRow[];
  query: string;
  filters: RiskFilters;
}) {
  return (
    <DownloadCsvButton
      report={REPORT}
      filename="risk-rules-assessment.csv"
      rowCount={filtered.length}
      build={() => riskRowsToCSV(filtered)}
      fullRowCount={rows.length}
      buildFull={() => riskRowsToCSV(rows)}
      query={query}
      filters={[...domainLabels(f), f.score, f.enforce, f.status]}
    />
  );
}
