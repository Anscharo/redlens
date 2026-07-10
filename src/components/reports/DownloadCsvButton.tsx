import { track } from "../../lib/analytics";
import { downloadCSV } from "../../lib/csv";

// Shared "Download CSV" control for the /reports/* pages. `build` is a thunk so
// the (potentially large) CSV string is only assembled on click, never on
// render. Disabled — and a no-op — when there are no rows to export.
export function DownloadCsvButton({
  report,
  filename,
  rowCount,
  build,
}: {
  report: string; // analytics slug, e.g. "oea-assessment"
  filename: string; // downloaded file name, e.g. "oea-task-assessment.csv"
  rowCount: number; // rows the export will contain (the filtered view)
  build: () => string; // returns the CSV text; called only on click
}) {
  return (
    <button
      type="button"
      onClick={() => {
        track("report_export", { report, format: "csv", row_count: rowCount });
        downloadCSV(filename, build());
      }}
      disabled={rowCount === 0}
      className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap self-start"
    >
      Download CSV
    </button>
  );
}
