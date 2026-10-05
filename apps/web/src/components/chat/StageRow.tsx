import type { ReactNode } from "react";
import type { StageLogEntry } from "./chatTypes";
import { stageLabel, stripTrailingEllipsis } from "./stageCopy";

// Marker + label + every detail line the stage reported. Every detail stays
// visible, done row or active — nothing shown to the reader disappears. A
// done row strips a trailing ellipsis so it doesn't read as still in
// progress; the active row's copy is untouched.
function StageHeader({ entry, active }: { entry: StageLogEntry; active: boolean }) {
  return (
    <>
      <span className="rlc-stage-marker" aria-hidden="true" />
      <div className="rlc-stage-body">
        <span className="rlc-stage-label">{stageLabel(entry.stage, active)}</span>
        {entry.details.map((d, di) => (
          <span key={di} className="rlc-stage-detail">
            {active ? d : stripTrailingEllipsis(d)}
          </span>
        ))}
      </div>
    </>
  );
}

export interface StageRowProps {
  entry: StageLogEntry;
  /** The turn's running stage — pulses and shows its live copy. */
  active: boolean;
  /** Working content to disclose under the row, or null for a plain row. */
  slot: ReactNode;
  /** Whether the slot is disclosed. */
  open: boolean;
  /** Toggles the slot. */
  onToggle: () => void;
}

// One checklist row. The header is the click target when a slot exists; the
// slot renders AFTER the header as a sibling, never nested inside it — a slot
// can carry its own interactive elements (ReasoningBlock's "thinking"
// toggle, citation links in a draft or superseded answer), and both a
// <button> inside a <button> and a click on any of those bubbling up to
// collapse the row are bugs, not just invalid HTML.
export function StageRow({ entry, active, slot, open, onToggle }: StageRowProps) {
  const slotId = `rlc-stage-slot-${entry.at}`;
  const header = <StageHeader entry={entry} active={active} />;
  return (
    <li className="rlc-stage" data-state={active ? "active" : "done"} data-round={entry.round}>
      {slot != null ? (
        <button type="button" className="rlc-stage-toggle" aria-expanded={open} aria-controls={slotId} onClick={onToggle}>
          {header}
        </button>
      ) : (
        <div className="rlc-stage-head">{header}</div>
      )}
      {open && slot != null && (
        <div id={slotId} className="rlc-stage-slot">
          {slot}
        </div>
      )}
    </li>
  );
}
