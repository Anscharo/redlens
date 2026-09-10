import type { ReactNode } from "react";
import { AtlasMarkdown, balanceFences } from "./markdown";
import { ParagraphChecks } from "./ParagraphChecks";
import { ReasoningBlock } from "./ReasoningBlock";
import { SupersededAnswer } from "./SupersededAnswer";
import { TraceRowView } from "./TraceRow";
import { VerifyFindings, hasFindings } from "./VerifyFindings";
import type { ChatMsg, StageLogEntry } from "./useChatStream";

// The synthesizing stage can repeat (a turn may synthesize, search again, and
// synthesize once more) — reasoning renders once, on the first occurrence,
// and the live draft only trails the last one, so neither is duplicated
// across rounds.
function synthesizingEntries(msg: ChatMsg): StageLogEntry[] {
  return (msg.stageLog ?? []).filter((e) => e.stage === "synthesizing");
}

// Facts run before round 1 (not per-round like tool calls), so this slot
// isn't filtered by `entry.round` the way `queryingSlot` is.
function recallingSlot(msg: ChatMsg): ReactNode {
  const facts = msg.trace.filter((t) => t.kind === "fact");
  if (!facts.length) return null;
  return (
    <>
      {facts.map((f, i) => (
        <TraceRowView key={i} e={f} />
      ))}
    </>
  );
}

function queryingSlot(msg: ChatMsg, entry: StageLogEntry): ReactNode {
  const rows = msg.trace.filter((t) => t.kind !== "fact" && t.round === entry.round);
  if (!rows.length) return null;
  return (
    <>
      {rows.map((r, i) => (
        <TraceRowView key={i} e={r} />
      ))}
    </>
  );
}

function synthesizingSlot(msg: ChatMsg, entry: StageLogEntry, onAtlas: (uuid: string) => void): ReactNode {
  const synths = synthesizingEntries(msg);
  const isFirst = synths[0]?.at === entry.at;
  const isLast = synths[synths.length - 1]?.at === entry.at;
  const drafts = (msg.superseded ?? []).filter((d) => d.round === entry.round);

  const parts: ReactNode[] = [];
  if (isFirst && msg.reasoning) parts.push(<ReasoningBlock key="reasoning" text={msg.reasoning} />);
  if (drafts.length) parts.push(<SupersededAnswer key="superseded" drafts={drafts} onAtlas={onAtlas} />);
  if (isLast && !msg.generated) {
    parts.push(
      <div key="draft" className="rlc-stage-draft">
        <AtlasMarkdown content={balanceFences(msg.draft)} onAtlas={onAtlas} />
      </div>,
    );
  }
  // Regardless of `msg.generated`: the checks belong to the round that ran
  // them, and they must keep rendering once the draft they audited is
  // cleared out (answer_final/done wipe `draft`, not `paragraphChecks`).
  if (isLast && msg.paragraphChecks?.length) {
    parts.push(<ParagraphChecks key="checks" checks={msg.paragraphChecks} />);
  }
  return parts.length ? <>{parts}</> : null;
}

function checkingSlot(msg: ChatMsg, onAtlas: (uuid: string) => void): ReactNode {
  // Null (no disclosure affordance on the row) when there is nothing to
  // disclose: still auditing, or a clean verdict.
  if (!msg.verify || msg.verify.status === "checking" || !hasFindings(msg.verify)) return null;
  return <VerifyFindings verify={msg.verify} onAtlas={onAtlas} />;
}

// The content shown under a stage row's label once that row is clicked open —
// what that stage actually did or produced, not just that it ran. `_active`
// is unused today (every slot's own arrival/generated checks already decide
// what to show) but kept in the signature for a future stage whose slot
// depends on being the currently-running one, not just the newest row in the
// log.
export function renderStageSlot(
  msg: ChatMsg,
  entry: StageLogEntry,
  _active: boolean,
  onAtlas: (uuid: string) => void,
): ReactNode {
  switch (entry.stage) {
    case "recalling":
      return recallingSlot(msg);
    case "querying":
      return queryingSlot(msg, entry);
    case "synthesizing":
      return synthesizingSlot(msg, entry, onAtlas);
    case "checking":
      return checkingSlot(msg, onAtlas);
    default:
      return null;
  }
}
