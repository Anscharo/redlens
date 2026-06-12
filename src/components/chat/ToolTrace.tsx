import { useState } from "react";
import type { TraceRow } from "./useChatStream";

// Collapsible tool-call trace (off by default; surfaced via the Preferences
// "show tool-call traces" switch). One row per tool call: arrow · name · args ·
// size. Mirrors the prototype's trace card.
function argSummary(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}: ${s}`;
  });
  return parts.join(" · ");
}

export function ToolTrace({ trace, rounds }: { trace: TraceRow[]; rounds: number }) {
  const [open, setOpen] = useState(false);
  if (!trace.length) return null;
  return (
    <div className="rlc-trace">
      <button className="rlc-trace-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="rlc-trace-caret" data-open={open} aria-hidden="true">
          ▾
        </span>
        <span>
          looked up {trace.length} thing{trace.length === 1 ? "" : "s"} over the atlas
        </span>
        {rounds > 1 && <span className="rlc-trace-rounds">· {rounds} rounds</span>}
      </button>
      {open && (
        <div>
          {trace.map((e, i) => (
            <div key={i} className="rlc-trace-row">
              <span className={e.ok === false ? "rlc-trace-arrow-err" : "rlc-trace-arrow-ok"}>
                {e.ok === false ? "×" : "→"}
              </span>
              <span className="rlc-trace-name">{e.name}</span>
              <span className="rlc-trace-arg">{argSummary(e.args)}</span>
              <span className="rlc-trace-meta">
                {e.bytes == null ? "…" : e.bytes >= 1024 ? `${(e.bytes / 1024).toFixed(1)} kB` : `${e.bytes} B`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
