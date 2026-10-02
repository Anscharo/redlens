// Scope/Entity pill groups and the CSV export for the Active Data Index report.
import { activeDataRowsToCSV, type ActiveDataRow } from "@/lib/activeDataIndex";
import type { ReportId } from "@/types";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";

export function ActiveDataControls({
  agents,
  agentFilter,
  onAgent,
  entityNames,
  entityFilter,
  onEntity,
}: {
  agents: string[];
  agentFilter: string | null;
  onAgent: (next: string) => void;
  entityNames: string[];
  entityFilter: string | null;
  onEntity: (next: string) => void;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <CategoryPills label="Scope" categories={agents} active={agentFilter} onToggle={onAgent} showSingle />
      <CategoryPills label="Entity" categories={entityNames} active={entityFilter} onToggle={onEntity} showSingle />
    </div>
  );
}

export function ActiveDataCsvButton({
  report,
  rows,
  shown,
  lastEditDates,
  query,
  filters,
}: {
  report: ReportId;
  rows: readonly ActiveDataRow[];
  shown: readonly ActiveDataRow[];
  lastEditDates: Map<string, string>;
  query: string;
  filters: (string | null)[];
}) {
  return (
    <DownloadCsvButton
      report={report}
      filename="active-data-index.csv"
      rowCount={shown.length}
      build={() => activeDataRowsToCSV(shown, lastEditDates)}
      fullRowCount={rows.length}
      buildFull={() => activeDataRowsToCSV(rows, lastEditDates)}
      query={query}
      filters={filters}
    />
  );
}
