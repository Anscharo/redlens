import { track } from "../../lib/analytics";
import { downloadCSV } from "../../lib/csvDownload";
import { insertBeforeExt } from "../../lib/reportFilter";
import { liveAtlasSha } from "../../lib/atlasBase";
import { useDataSource } from "../../lib/dataSource";
import { BTN_CLASS } from "./DownloadCsvButton";

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
  const { preview } = useDataSource();
  const sha = preview?.sha ?? liveAtlasSha();
  const onClick = () => {
    track("report_export", { report, format: "csv", row_count: rowCount, scope: "full" });
    const name = insertBeforeExt(filename, sha ? sha.slice(0, 8) : "");
    downloadCSV(name, build());
  };
  return (
    <button type="button" onClick={onClick} disabled={rowCount === 0} className={BTN_CLASS}>
      {label}
    </button>
  );
}
