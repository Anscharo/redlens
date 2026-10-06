import type { ReactNode } from "react";
import type { StageLogEntry } from "./chatTypes";
import { stageLabel, stripTrailingEllipsis } from "./stageCopy";

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
  open: boolean;
  onToggle: () => void;
}

// The slot is the header button's sibling, never its child: it can hold its own
// buttons and links, whose clicks must not bubble up and collapse the row.
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
