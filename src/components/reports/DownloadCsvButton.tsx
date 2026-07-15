import { track } from "../../lib/analytics";
import { downloadCSV } from "../../lib/csv";

const BTN_CLASS =
  "mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";

// CSV downloads for the /reports/* pages. Two controls:
//   • "Download full report" — always visible, always exports the full
//     (unfiltered) dataset, regardless of any active search/filters.
//   • "Download filtered report" — shown only while a search or filter is
//     active; exports the currently visible rows (the old single-button
//     behavior).
// `build`/`buildFull` are thunks so the (potentially large) CSV string is only
// assembled on click, never on render.
export function DownloadCsvButton({
  report,
  filename,
  rowCount,
  build,
  fullRowCount,
  buildFull,
  filtering,
}: {
  report: string; // analytics slug, e.g. "oea-assessment"
  filename: string; // downloaded file name, e.g. "oea-task-assessment.csv"
  rowCount: number; // rows in the filtered view
  build: () => string; // filtered CSV text; called only on click
  fullRowCount: number; // rows in the full (unfiltered) dataset
  buildFull: () => string; // full CSV text; called only on click
  filtering: boolean; // whether a search/filter is currently active
}) {
  const download = (scope: "full" | "filtered", count: number, builder: () => string) => {
    track("report_export", { report, format: "csv", row_count: count, scope });
    downloadCSV(filename, builder());
  };
  return (
    <div className="flex items-center gap-2 self-start">
      {filtering && (
        <button
          type="button"
          onClick={() => download("filtered", rowCount, build)}
          disabled={rowCount === 0}
          className={BTN_CLASS}
        >
          Download filtered report
        </button>
      )}
      <button
        type="button"
        onClick={() => download("full", fullRowCount, buildFull)}
        disabled={fullRowCount === 0}
        className={BTN_CLASS}
      >
        Download full report
      </button>
    </div>
  );
}
