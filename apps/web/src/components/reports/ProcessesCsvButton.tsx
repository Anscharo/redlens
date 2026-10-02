// CSV export action for the Processes report: the filtered rows, or every row
// for the full export, with each row's local ignore mark. Its filter labels
// name the active pills so the two downloads are distinguishable on disk.
import { processRowsToCSV } from "@/lib/processesIndex";
import type { ReportId } from "@/types";
import { DownloadCsvButton } from "./DownloadCsvButton";
import type { useProcessesState } from "./useProcessesState";

type ProcessesCsvButtonProps = {
  report: ReportId;
  state: ReturnType<typeof useProcessesState>;
  query: string;
};

export function ProcessesCsvButton({ report, state: s, query }: ProcessesCsvButtonProps) {
  const ignoresByUuid = s.ignores.byUuid;
  return (
    <DownloadCsvButton
      report={report}
      filename="atlas-processes.csv"
      rowCount={s.filtered.length}
      build={() => processRowsToCSV(s.filtered, ignoresByUuid)}
      fullRowCount={s.rows.length}
      buildFull={() => processRowsToCSV(s.rows, ignoresByUuid)}
      query={query}
      filters={[s.category, s.status !== "all" && s.status, s.shape !== "all" && s.shape, s.showIgnored && "show ignored"]}
    />
  );
}
