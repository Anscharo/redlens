import { downloadFile } from "../../lib/csvDownload";
import { track } from "../../lib/analytics";
import type { ExportArtifact } from "./useChatStream";

// Export cluster: one download button per file the agent handed over this turn
// via export_findings. The file already auto-downloaded on arrival; this button
// is the gesture-safe fallback (Safari can block the async auto-download) and a
// way to re-download. Clicking is a real user gesture, so it's always allowed.
export function ExportChips({ exports }: { exports: ExportArtifact[] }) {
  if (!exports.length) return null;
  return (
    <div className="rlc-exports">
      <p className="rlc-sources-label">files · {exports.length}</p>
      <div className="rlc-sources-chips">
        {exports.map((x, i) => (
          <button
            key={`${x.filename}-${i}`}
            type="button"
            className="rlc-export-chip"
            onClick={() => {
              track("chat_export", { format: x.format, bytes: x.bytes, source: "button" });
              downloadFile(x.filename, x.content, x.mime, x.format === "csv");
            }}
          >
            <span className="rlc-export-icon" aria-hidden="true">
              ⤓
            </span>
            <span className="rlc-export-name">{x.filename}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
