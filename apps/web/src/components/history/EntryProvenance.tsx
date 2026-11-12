import { RECONSTRUCTED_ERAS } from "@/lib/history";
import { Tooltip } from "../Tooltip";
import { HtmlEraDisclaimer, PreGitDisclaimer } from "./HistoryDisclaimers";

function InfoIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="8" r="1.4" fill="currentColor" />
      <path d="M12 11.5v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Info mark beside a reconstructed entry's date. Its tooltip is the provenance note. */
export function EntryProvenance({ era }: { era?: string }) {
  if (!era || !RECONSTRUCTED_ERAS.has(era)) return null;
  const html = era === "html";
  return (
    <Tooltip content={html ? <HtmlEraDisclaimer /> : <PreGitDisclaimer />}>
      <span
        tabIndex={0}
        role="note"
        aria-label={html ? "This history is reconstructed" : "This history comes from pre-git sources"}
        className="shrink-0 inline-flex items-center cursor-help"
        style={{ color: "var(--tan-3)" }}
      >
        <InfoIcon />
      </span>
    </Tooltip>
  );
}
