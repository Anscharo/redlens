import type { StageLogEntry } from "./useChatStream";

// docs/plans/chat-staged-delivery.md user-facing stage copy. Unknown stages
// (forward-compat with a server that adds one before the client updates)
// fall back to a capitalized raw label instead of disappearing.
const STAGE_LABEL: Record<string, string> = {
  querying: "Looking for evidence",
  reading: "Reading documents",
  comparing: "Comparing results",
  synthesizing: "Synthesizing",
  checking: "Verifying content",
  advising: "Seeking advice",
  revising: "Revising claims",
  finalizing: "Preparing final report",
};

function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage.charAt(0).toUpperCase() + stage.slice(1);
}

// The staged-mode "what's happening" checklist, shown in place of the (still
// empty) answer body. Past stages read as done (muted, completed marker);
// the last entry is active — its detail line is the point (tool names, doc
// counts) so the wait reads as progress, not a spinner.
export function StageList({ entries }: { entries: StageLogEntry[] }) {
  return (
    <ol className="rlc-stages" aria-label="Answer progress">
      {entries.map((entry, i) => {
        const active = i === entries.length - 1;
        return (
          <li key={entry.at} className="rlc-stage" data-state={active ? "active" : "done"}>
            <span className="rlc-stage-marker" aria-hidden="true" />
            <div className="rlc-stage-body">
              <span className="rlc-stage-label">{stageLabel(entry.stage)}</span>
              {active && entry.detail && <span className="rlc-stage-detail">{entry.detail}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
