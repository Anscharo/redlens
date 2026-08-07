import { BTN_CLASS, exportReportCsv, useAtlasSha } from "./DownloadCsvButton";

// A single-file CSV download for a dataset with no filtered/full duality —
// e.g. a category rollup table, which always reflects every category
// regardless of the header search box. DownloadCsvButton's two-button
// filtered/full model doesn't apply here, so this is the plain one-button case.
export function SingleDownloadButton({
  report,
  filename,
  rowCount,
  build,
  label,
}: {
  report: string; // analytics slug, e.g. "mod-frequency-summary-section"
  filename: string;
  rowCount: number;
  build: () => string; // called only on click
  label: string;
}) {
  const sha = useAtlasSha();
  const onClick = () => exportReportCsv({ report, filename, rowCount, scope: "full", sha, build });
  return (
    <button type="button" onClick={onClick} disabled={rowCount === 0} className={BTN_CLASS}>
      {label}
    </button>
  );
}
