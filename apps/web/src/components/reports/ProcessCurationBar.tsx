import { useCopyState } from "../../hooks/useCopyState";
import { downloadFile } from "../../lib/csvDownload";
import { toDecisionsJson, type LocalIgnore } from "../../lib/curationStore";
import { track } from "../../lib/analytics";

const BTN =
  "px-2 py-1 rounded bg-[var(--hover)] text-tan text-xs hover:bg-[color-mix(in_srgb,var(--accent)_25%,var(--hover))]";

export function ProcessCurationBar({
  marks,
  onClear,
  showIgnored,
  onToggleShowIgnored,
}: {
  marks: LocalIgnore[];
  onClear: () => void;
  showIgnored: boolean;
  onToggleShowIgnored: () => void;
}) {
  const { copied, copy: copyText } = useCopyState(1500);
  if (marks.length === 0) return null;

  const json = toDecisionsJson(marks);

  const download = () => {
    track("report_export", { report: "processes", format: "json", method: "download" });
    downloadFile("processes-decisions.json", json, "application/json");
  };

  const copy = () => {
    track("report_export", { report: "processes", format: "json", method: "copy" });
    void copyText(json);
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 p-3 bg-[var(--surface)] rounded text-sm">
      <span className="text-tan">
        <strong>{marks.length}</strong> marked locally as NonProcess
      </span>
      <button onClick={download} className={BTN}>
        Download JSON
      </button>
      <button onClick={copy} className={BTN}>
        {copied ? "Copied!" : "Copy JSON"}
      </button>
      <button onClick={onToggleShowIgnored} className={BTN}>
        {showIgnored ? "Hide ignored" : "Show ignored"}
      </button>
      <button
        onClick={onClear}
        className="px-2 py-1 text-tan-3 hover:text-tan text-xs ml-auto"
      >
        Clear all
      </button>
      <p className="basis-full text-xs text-tan-3">
        Save as <code className="mono">.cache/processes-decisions.json</code>, then run{" "}
        <code className="mono">pnpm processes:apply-decisions .cache/processes-decisions.json</code>
        {" "}to merge into <code className="mono">public/processes-ignored.json</code>.
      </p>
    </div>
  );
}
