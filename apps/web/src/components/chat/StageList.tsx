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

// The collapsed checklist's one-line summary (shown only for a turn that
// mounts already finished). Fixed phrases, never counts: "looked up 2
// things" and "recalled 1 thing" invited the reader to go looking for the
// items, and what was recalled or looked up is context the model reasons
// over, not a deliverable. Recalled (facts) and looked-up (tool calls) are
// still different claims, so the phrase names whichever happened.
export function traceHeadline(trace: TraceRow[]): string {
  const facts = trace.some((t) => t.kind === "fact");
  const tools = trace.some((t) => t.kind !== "fact");
  if (facts && tools) return "recall, atlas lookups and reasoning";
  if (facts) return "recall and reasoning";
  if (tools) return "atlas lookups and reasoning";
  return "reasoning";
}

export interface StageListProps {
  entries: StageLogEntry[];
  // The turn has finished. A list that MOUNTED live keeps its full tree
  // (folding it would move the answer under a reader mid-sentence); one
  // that mounts already finished (a reopened panel, a reloaded thread)
  // starts as the one-line summary and opens on click.
  collapsed: boolean;
  summary: string;
  // `at` of the stage the turn is currently in. The turn's rows are split
  // across two lists (before / after the answer), so "the last row of this
  // list" is not "the running stage" — defaults to it when there is one list.
  activeAt?: number;
  children?: never;
  renderSlot: (entry: StageLogEntry, active: boolean) => ReactNode;
}

// The turn's "what it's doing" checklist. While the turn is live it always
// renders the full tree (every row, current one active), and a list that
// was live when it mounted keeps that tree after the turn is done. Only a
// list that mounts already `collapsed` starts folded to one summary line —
// the same copy a tool trace headline used to show — and a click on it
// reveals the full tree for someone who wants to see how the answer was
// built.
//
// Each row is its own disclosure, independent of that fold: clicking a row
// (there is no panel-wide "details" toggle any more) expands that step's
// working content — lookups, reasoning + draft, verify findings — under its
// label; clicking again collapses just that row. `open` tracks expanded rows
// by their stable `entry.at` key, so re-renders mid-stream don't reset it.
export function StageList({ entries, collapsed, summary, activeAt, renderSlot }: StageListProps) {
  // Fixed at mount: a live checklist stays a checklist for the rest of its
  // life — the final render must not rearrange what is on screen.
  const [liveAtMount] = useState(!collapsed);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const showTree = !collapsed || expanded || liveAtMount;
  const runningAt = activeAt ?? entries[entries.length - 1]?.at;

  const toggleRow = (at: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
    // Opening a row is the reader saying "I'm reading this" — so when the
    // turn finishes, the tree stays exactly where they left it instead of
    // folding to the summary line under them. The summary head still folds
    // it on request.
    if (!open.has(at)) setExpanded(true);
  };

  return (
    <div className="rlc-stage-summary">
      {/* The summary line is the fold control once the turn is done: it opens
          the tree and, on a second click, folds it again. */}
      {collapsed && !liveAtMount && (
        <button className="rlc-stage-summary-head" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <span className="rlc-trace-caret" data-open={expanded} aria-hidden="true">
            ▾
          </span>
          <span>{summary}</span>
        </button>
      )}
      {showTree && (
        <ol className="rlc-stages" aria-label="Answer progress">
          {entries.map((entry) => {
            // A row only pulses/shows its live detail while the turn is still
            // running — once `collapsed` (the turn is done), every row is
            // "done" even the last one, so a reopened or stopped/failed
            // turn's checklist doesn't keep "Verifying content" pulsing
            // forever after its verdict already rendered.
            const active = !collapsed && entry.at === runningAt;
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
