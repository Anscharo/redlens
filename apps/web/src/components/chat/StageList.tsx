import { useState, type ReactNode } from "react";
import type { StageLogEntry, TraceRow } from "./useChatStream";

// docs/chat-system.md §8 user-facing stage copy. Unknown stages
// (forward-compat with a server that adds one before the client updates)
// fall back to a capitalized raw label instead of disappearing. Every turn
// now runs the same stage vocabulary (see api.ts's `Stage` type).
const STAGE_LABEL: Record<string, string> = {
  recalling: "Recalling context",
  querying: "Looking for evidence",
  comparing: "Comparing results",
  synthesizing: "Synthesizing",
  checking: "Verifying content",
};

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}

// Recalled and looked-up are different claims, and a turn can be either or
// both: facts alone (the app-documentation answer needs no tool call) would
// otherwise read as "looked up 1 thing over the atlas", which is neither.
// This is the checklist's collapsed-summary copy — the same phrasing a
// standalone trace card's header used to show.
export const things = (n: number) => `${n} thing${n === 1 ? "" : "s"}`;

export function traceHeadline(trace: TraceRow[]): string {
  const facts = trace.filter((t) => t.kind === "fact").length;
  const tools = trace.length - facts;
  return [facts > 0 && `recalled ${things(facts)}`, tools > 0 && `looked up ${things(tools)} over the atlas`]
    .filter(Boolean)
    .join(" · ");
}

export interface StageListProps {
  entries: StageLogEntry[];
  // The turn has finished: render the one-line collapsed summary instead of
  // the full tree, until the reader clicks it open.
  collapsed: boolean;
  summary: string;
  children?: never;
  renderSlot: (entry: StageLogEntry, active: boolean) => ReactNode;
}

// The turn's "what it's doing" checklist. While the turn is live it always
// renders the full tree (every row, current one active); once `collapsed`
// (the turn is done) it starts folded to one summary line — the same copy a
// tool trace headline used to show — and a click on it reveals the full tree
// for someone who wants to see how the answer was built.
//
// Each row is its own disclosure, independent of that fold: clicking a row
// (there is no panel-wide "details" toggle any more) expands that step's
// working content — lookups, reasoning + draft, verify findings — under its
// label; clicking again collapses just that row. `open` tracks expanded rows
// by their stable `entry.at` key, so re-renders mid-stream don't reset it.
export function StageList({ entries, collapsed, summary, renderSlot }: StageListProps) {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const showTree = !collapsed || expanded;

  const toggleRow = (at: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });

  return (
    <div className="rlc-stage-summary">
      {/* The summary line is the fold control once the turn is done: it opens
          the tree and, on a second click, folds it again. */}
      {collapsed && (
        <button className="rlc-stage-summary-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <span className="rlc-trace-caret" data-open={expanded} aria-hidden="true">
            ▾
          </span>
          <span>{summary}</span>
        </button>
      )}
      {showTree && (
        <ol className="rlc-stages" aria-label="Answer progress">
          {entries.map((entry, i) => {
            // A row only pulses/shows its live detail while the turn is still
            // running — once `collapsed` (the turn is done), every row is
            // "done" even the last one, so a reopened or stopped/failed
            // turn's checklist doesn't keep "Verifying content" pulsing
            // forever after its verdict already rendered.
            const active = !collapsed && i === entries.length - 1;
            const slot = renderSlot(entry, active);
            const rowOpen = open.has(entry.at);
            const slotId = `rlc-stage-slot-${entry.at}`;
            // The header (marker + label + active detail) is the click
            // target when a slot exists; the slot itself renders AFTER the
            // header as a sibling, never nested inside it — a nested slot
            // can carry its own interactive elements (ReasoningBlock's
            // "thinking" toggle, citation links in a draft or superseded
            // answer), and both a <button> inside a <button> and a click on
            // any of those bubbling up to collapse the row are bugs, not
            // just invalid HTML.
            const header = (
              <>
                <span className="rlc-stage-marker" aria-hidden="true" />
                <div className="rlc-stage-body">
                  <span className="rlc-stage-label">{stageLabel(entry.stage)}</span>
                  {/* Every detail line the stage reported stays visible, done
                      row or active — nothing shown to the reader disappears. */}
                  {entry.details.map((d, di) => (
                    <span key={di} className="rlc-stage-detail">
                      {d}
                    </span>
                  ))}
                </div>
              </>
            );
            return (
              <li key={entry.at} className="rlc-stage" data-state={active ? "active" : "done"} data-round={entry.round}>
                {slot != null ? (
                  <button
                    type="button"
                    className="rlc-stage-toggle"
                    aria-expanded={rowOpen}
                    aria-controls={slotId}
                    onClick={() => toggleRow(entry.at)}
                  >
                    {header}
                  </button>
                ) : (
                  <div className="rlc-stage-head">{header}</div>
                )}
                {rowOpen && slot != null && (
                  <div id={slotId} className="rlc-stage-slot">
                    {slot}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
