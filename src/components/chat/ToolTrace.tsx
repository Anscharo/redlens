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

// A fact row has no call to show: it is knowledge the server recalled before
// the model ran, so it reads as its summary ("2 glossary definitions") under a
// marker that is not the tool arrow.
function TraceRowView({ e }: { e: TraceRow }) {
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

const things = (n: number) => `${n} thing${n === 1 ? "" : "s"}`;

// Recalled and looked-up are different claims, and a turn can be either or
// both: facts alone (the app-documentation answer needs no tool call) would
// otherwise read as "looked up 1 thing over the atlas", which is neither.
function traceHeadline(trace: TraceRow[]): string {
  const facts = trace.filter((t) => t.kind === "fact").length;
  const tools = trace.length - facts;
  return [facts > 0 && `recalled ${things(facts)}`, tools > 0 && `looked up ${things(tools)} over the atlas`]
    .filter(Boolean)
    .join(" · ");
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
        <span>{traceHeadline(trace)}</span>
        {rounds > 1 && <span className="rlc-trace-rounds">· {rounds} rounds</span>}
      </button>
      {open && (
        <div>
          {trace.map((e, i) => (
            <TraceRowView key={i} e={e} />
          ))}
        </div>
      )}
    </div>
  );
}
