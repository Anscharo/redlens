import { StageList } from "./StageList";
import { StageSlot } from "./StageSlot";
import { stageSlotContent } from "./stageSlotContent";
import type { ChatMsg, StageLogEntry } from "./chatTypes";

export function UserTurn({ text }: { text: string }) {
  return (
    <div className="rlc-turn flex justify-end mb-4">
      <div className="max-w-[85%]">
        <div className="rlc-user-label mb-1">you</div>
        <div className="rlc-user-bubble">{text}</div>
      </div>
    </div>
  );
}

export interface TurnStagesProps {
  /** The turn whose stages these are; its working content fills each row's slot. */
  msg: ChatMsg;
  /** This list's rows (a turn renders two lists, before and after the answer). */
  entries: StageLogEntry[];
  /** The folded list's one-line summary. */
  summary: string;
  /** Accessible name, when it must differ from the default. */
  label?: string;
  /** `at` of the stage the whole turn is currently in. */
  activeAt?: number;
  onAtlas: (uuid: string) => void;
}

// One of a turn's stage checklists, or nothing when it has no rows. A row's
// slot is what stageSlotContent says that stage discloses — null for a stage
// with nothing to show, which StageList renders as plain text instead of a
// disclosure button.
export function TurnStages({ msg, entries, summary, label, activeAt, onAtlas }: TurnStagesProps) {
  if (entries.length === 0) return null;
  const slotFor = (entry: StageLogEntry) => {
    const content = stageSlotContent(msg, entry);
    return content && <StageSlot content={content} onAtlas={onAtlas} />;
  };
  return (
    <StageList entries={entries} collapsed={msg.done} summary={summary} activeAt={activeAt} label={label} renderSlot={slotFor} />
  );
}
