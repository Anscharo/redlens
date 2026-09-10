import type { TraceRow } from "./useChatStream";

// One row of a stage's tool/fact trace. The collapsible top-level trace card
// this used to live in is gone — trace rows now render per-round inside
// StageSlots.tsx's "recalling"/"querying" slots — so this keeps only the row
// markup and its arg-summarizer, without their old container.
function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}: ${s}`;
  });
  return parts.join(" · ");
}

// A fact row has no call to show: it is knowledge the server recalled before
// the model ran, so it reads as its summary ("2 glossary definitions") under a
// marker that is not the tool arrow.
export function TraceRowView({ e }: { e: TraceRow }) {
  if (e.kind === "fact") {
    return (
      <div className="rlc-trace-row" data-kind="fact">
        <span className="rlc-trace-arrow-fact" aria-hidden="true">
          ✦
        </span>
        <span className="rlc-trace-name">{e.name}</span>
        <span className="rlc-trace-arg">{e.summary}</span>
        <span className="rlc-trace-meta">recalled</span>
      </div>
    );
  }
  return (
    <div className="rlc-trace-row">
      <span className={e.ok === false ? "rlc-trace-arrow-err" : "rlc-trace-arrow-ok"}>
        {e.ok === false ? "×" : <span className="enlargen">→</span>}
      </span>
      <span className="rlc-trace-name">{e.name}</span>
      <span className="rlc-trace-arg">{argSummary(e.args)}</span>
      <span className="rlc-trace-meta">
        {e.bytes == null ? "…" : e.bytes >= 1024 ? `${(e.bytes / 1024).toFixed(1)} kB` : `${e.bytes} B`}
      </span>
    </div>
  );
}
