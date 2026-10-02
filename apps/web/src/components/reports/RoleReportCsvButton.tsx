// CSV export for a role-responsibility report: the filtered rows, or every
// responsibility for the "full" download. Row counts expand collapsed duties.
import { expandedRowCount } from "@/lib/dutyCollapse";
import { DownloadCsvButton } from "./DownloadCsvButton";
import type { RoleRow } from "./RoleCategoryTable";
import type { RoleReportConfig } from "./roleReportTypes";
import type { useRoleReportState } from "./useRoleReportState";

export function RoleReportCsvButton<R extends RoleRow>({
  config,
  state,
  query,
}: {
  config: RoleReportConfig<R>;
  state: ReturnType<typeof useRoleReportState<R>>;
  query: string;
}) {
  const { filtered, responsibilities } = state;
  return (
    <DownloadCsvButton
      report={config.reportId}
      filename={config.filename}
      rowCount={expandedRowCount(filtered)}
      build={() => config.rowsToCSV(filtered)}
      fullRowCount={expandedRowCount(responsibilities)}
      buildFull={() => config.rowsToCSV(responsibilities)}
      query={query}
      filters={[state.filterName, state.cat]}
    />
  );
}
