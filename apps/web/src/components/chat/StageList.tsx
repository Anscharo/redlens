import { useId, useState, type ReactNode } from "react";
import type { StageLogEntry } from "./useChatStream";
import { StageRow } from "./StageRow";

export { traceHeadline } from "./stageCopy";

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
  // Accessible name for this list. A turn renders TWO StageLists (before and
  // after the answer — see Message.tsx), so they must not share one name:
  // a reader hearing "Answer progress list" twice in one message has no way
  // to tell which is which.
  label?: string;
  children?: never;
  // The working content to disclose under `entry`'s row, or null when that
  // stage has nothing to show — a row with no slot renders as plain text
  // rather than as a disclosure button.
  renderSlot: (entry: StageLogEntry) => ReactNode;
}

// The list's fold and which rows are open. `liveAtMount` is fixed at mount: a
// live checklist stays a checklist for the rest of its life — the final
// render must not rearrange what is on screen. Opening a row is the reader
// saying "I'm reading this" — so when the turn finishes, the tree stays
// exactly where they left it instead of folding to the summary line under
// them. The summary head still folds it on request.
function useStageFold(collapsed: boolean) {
  const [liveAtMount] = useState(!collapsed);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggleRow = (at: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
    if (!open.has(at)) setExpanded(true);
  };
  return { liveAtMount, expanded, setExpanded, open, toggleRow };
}

interface SummaryHeadProps {
  summary: string;
  expanded: boolean;
  /** id of the tree this head folds. */
  treeId: string;
  onToggle: () => void;
}

// The summary line is the fold control once the turn is done: it opens the
// tree and, on a second click, folds it again.
function SummaryHead({ summary, expanded, treeId, onToggle }: SummaryHeadProps) {
  return (
    <button className="rlc-stage-summary-head" onClick={onToggle} aria-expanded={expanded} aria-controls={treeId}>
      <span className="rlc-trace-caret" data-open={expanded} aria-hidden="true">
        ▾
      </span>
      <span>{summary}</span>
    </button>
  );
}

// The turn's "what it's doing" checklist. While the turn is live it always
// renders the full tree (every row, current one active), and a list that
// was live when it mounted keeps that tree after the turn is done. Only a
// list that mounts already `collapsed` starts folded to one summary line,
// and a click on it reveals the full tree for someone who wants to see how
// the answer was built.
//
// Each row is its own disclosure, independent of that fold: clicking a row
// expands that step's working content — lookups, reasoning + draft, verify
// findings — under its label; clicking again collapses just that row. Open
// rows are tracked by their stable `entry.at` key, so re-renders mid-stream
// don't reset them. A row only pulses as active while the turn is still
// running — once `collapsed` (the turn is done), every row is "done" even
// the last one, so a reopened or stopped/failed turn's checklist doesn't keep
// "Verifying content" pulsing after its verdict already rendered.
export function StageList({ entries, collapsed, summary, activeAt, label = "Answer progress", renderSlot }: StageListProps) {
  const fold = useStageFold(collapsed);
  const runningAt = activeAt ?? entries[entries.length - 1]?.at;
  const treeId = useId();
  return (
    <div className="rlc-stage-summary">
      {collapsed && !fold.liveAtMount && (
        <SummaryHead summary={summary} expanded={fold.expanded} treeId={treeId} onToggle={() => fold.setExpanded((v) => !v)} />
      )}
      {(!collapsed || fold.expanded || fold.liveAtMount) && (
        <ol id={treeId} className="rlc-stages" aria-label={label}>
          {entries.map((entry) => (
            <StageRow
              key={entry.at}
              entry={entry}
              active={!collapsed && entry.at === runningAt}
              slot={renderSlot(entry)}
              open={fold.open.has(entry.at)}
              onToggle={() => fold.toggleRow(entry.at)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
