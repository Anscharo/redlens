import { track } from "../../lib/analytics";
import { downloadCSV } from "../../lib/csvDownload";
import { filteredExportName, hasActiveFilter, insertBeforeExt } from "../../lib/reportFilter";
import { liveAtlasSha } from "../../lib/atlasBase";
import { useDataSource } from "../../lib/dataSource";

type FilterVal = string | false | null | undefined;

// Shared with SingleDownloadButton.tsx, for the same look on a page with a
// second, filtered/full-duality-free download (e.g. a category rollup).
export const BTN_CLASS =
  "mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";

// Tags a download with the atlas version it was taken from, so a saved CSV is
// traceable to a specific atlas commit (preview sha when in preview mode,
// else the live injected sha; omitted in dev/cold boot where no sha exists).
// Shared by SingleDownloadButton.tsx.
export function useAtlasSha(): string | null {
  const { preview } = useDataSource();
  return preview?.sha ?? liveAtlasSha();
}

// Fires the export analytics event, stamps the sha onto the filename, and
// triggers the download. Shared by SingleDownloadButton.tsx.
export function exportReportCsv(opts: {
  report: string;
  filename: string;
  rowCount: number;
  scope: "full" | "filtered";
  sha: string | null;
  build: () => string;
}) {
  track("report_export", { report: opts.report, format: "csv", row_count: opts.rowCount, scope: opts.scope });
  const name = insertBeforeExt(opts.filename, opts.sha ? opts.sha.slice(0, 8) : "");
  downloadCSV(name, opts.build());
}

// CSV downloads for the /reports/* pages. Two controls:
//   • "Download full report" — always visible, always exports the full
//     (unfiltered) dataset, regardless of any active search/filters.
//   • "Download filtered report" — shown only while a search or filter is
//     active; exports the currently visible rows (the old single-button
//     behavior). Its file name carries a best-effort marker of the active
//     query/filters so the two downloads are distinguishable on disk.
// `build`/`buildFull` are thunks so the (potentially large) CSV string is only
// assembled on click, never on render. `query`/`filters` are the same values
// the report hands <FilterSummary>, so button visibility stays in sync with the
// on-screen filter callout.
export function DownloadCsvButton({
  report,
  filename,
  rowCount,
  build,
  fullRowCount,
  buildFull,
  query,
  filters = [],
}: {
  report: string; // analytics slug, e.g. "oea-assessment"
  filename: string; // downloaded file name, e.g. "oea-task-assessment.csv"
  rowCount: number; // rows in the filtered view
  build: () => string; // filtered CSV text; called only on click
  fullRowCount: number; // rows in the full (unfiltered) dataset
  buildFull: () => string; // full CSV text; called only on click
  query: string; // active header-box query
  filters?: FilterVal[]; // active pill filters (labels), matching FilterSummary
}) {
  const filtering = hasActiveFilter(query, filters);
  const sha = useAtlasSha();
  const download = (scope: "full" | "filtered", count: number, builder: () => string) => {
    const base = scope === "filtered" ? filteredExportName(filename, query, filters) : filename;
    exportReportCsv({ report, filename: base, rowCount: count, scope, sha, build: builder });
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
