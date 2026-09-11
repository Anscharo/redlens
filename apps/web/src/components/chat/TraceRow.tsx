import type { TraceRow } from "./useChatStream";

// One row of a stage's tool/fact trace. The collapsible top-level trace card
// this used to live in is gone — trace rows now render per-round inside
// StageSlot.tsx's "recalling"/"querying" slots — so this keeps only the row
// markup and its arg-summarizer, without their old container.
function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}: ${s}`;
  });
  return parts.join(" · ");
}

export interface TraceRowViewProps {
  /** The tool call, or the fact the server recalled, that this row reports. */
  row: TraceRow;
}

// A fact row has no call to show: it is knowledge the server recalled before
// the model ran, so it reads as its summary ("2 glossary definitions") under a
// marker that is not the tool arrow.
export function TraceRowView({ row }: TraceRowViewProps) {
  if (row.kind === "fact") {
    return (
      <div className="rlc-trace-row" data-kind="fact">
        <span className="rlc-trace-arrow-fact" aria-hidden="true">
          ✦
        </span>
        <span className="rlc-trace-name">{row.name}</span>
        <span className="rlc-trace-arg">{row.summary}</span>
        <span className="rlc-trace-meta">recalled</span>
      </div>
    );
  }
  return (
    <div className="rlc-trace-row">
      <span className={row.ok === false ? "rlc-trace-arrow-err" : "rlc-trace-arrow-ok"}>
        {row.ok === false ? "×" : <span className="enlargen">→</span>}
      </span>
      <span className="rlc-trace-name">{row.name}</span>
      <span className="rlc-trace-arg">{argSummary(row.args)}</span>
      <span className="rlc-trace-meta">
        {row.bytes == null ? "…" : row.bytes >= 1024 ? `${(row.bytes / 1024).toFixed(1)} kB` : `${row.bytes} B`}
      </span>
    </div>
  );
}
