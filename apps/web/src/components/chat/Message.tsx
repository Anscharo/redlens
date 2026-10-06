import { SparkMark } from "./glyphs";
import { traceHeadline } from "./stageCopy";
import { AnswerBody, AnswerFooter, turnOutcome } from "./AnswerParts";
import type { CollectionLink } from "./Sources";
import { TurnStages, UserTurn } from "./TurnParts";
import { useAnswerReveal } from "./useAnswerReveal";
import type { ChatMsg } from "./useChatStream";

// The stages that run on the answer once it exists. Their rows render AFTER
// the answer, so the answer sits directly under the Synthesizing row — the
// place the reader was watching it form — and nothing already on screen
// moves when these rows arrive or when the answer lands between them.
const POST_ANSWER_STAGES = new Set(["comparing", "checking"]);
const POST_ANSWER_SUMMARY = "compared and verified";
// Both lists belong to one turn, so each needs its own accessible name.
const POST_ANSWER_LABEL = "Answer checks";

export interface MessageProps {
  msg: ChatMsg;
  /** This is the turn currently streaming. */
  streaming: boolean;
  /** Opens an atlas document behind a citation link anywhere in the turn. */
  onAtlas: (uuid: string) => void;
  /** Called once, with the answer element, when this turn's answer is revealed. */
  onAnswerReveal?: (el: HTMLElement) => void;
  /** Opens the conversation's cited docs as a collection; absent before the conversation has an id. */
  collection?: CollectionLink;
}

function AssistantTurn({ msg, streaming, onAtlas, onAnswerReveal, collection }: MessageProps) {
  const stageLog = msg.stageLog ?? [];
  const outcome = turnOutcome(msg, streaming);
  const answerRef = useAnswerReveal(msg.generated || msg.done, msg.content, onAnswerReveal);
  const stages = { msg, activeAt: stageLog[stageLog.length - 1]?.at, onAtlas };
  return (
    <div className="rlc-turn mb-[18px]">
      <div className="flex items-center gap-[7px] mb-[7px]">
        <SparkMark size={13} />
        <span className="rlc-agent-label">atlas agent</span>
      </div>
      <TurnStages {...stages} entries={stageLog.filter((e) => !POST_ANSWER_STAGES.has(e.stage))} summary={traceHeadline(msg.trace)} />
      {/* Pre-first-stage window only — once a stage row exists the checklist
          above is the "something's happening" signal instead. */}
      {streaming && stageLog.length === 0 && (
        <div className="rlc-thinking">
          <span className="rlc-twinkle">✦</span> {msg.statusLine ?? "searching the stars…"}
        </div>
      )}
      <AnswerBody msg={msg} outcome={outcome} answerRef={answerRef} onAtlas={onAtlas} />
      <TurnStages
        {...stages}
        entries={stageLog.filter((e) => POST_ANSWER_STAGES.has(e.stage))}
        summary={POST_ANSWER_SUMMARY}
        label={POST_ANSWER_LABEL}
      />
      {outcome === "answer" && <AnswerFooter msg={msg} onAtlas={onAtlas} collection={collection} />}
    </div>
  );
}

export function Message({ msg, streaming, onAtlas, onAnswerReveal, collection }: MessageProps) {
  if (msg.role === "user") return <UserTurn text={msg.content} />;
  return <AssistantTurn msg={msg} streaming={streaming} onAtlas={onAtlas} onAnswerReveal={onAnswerReveal} collection={collection} />;
}
