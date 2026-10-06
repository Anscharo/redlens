import type { RefObject } from "react";
import { AtlasMarkdown, balanceFences, extractSources } from "./markdown";
import { Sources, type CollectionLink } from "./Sources";
import { ExportChips } from "./ExportChips";
import { VerifyBadge } from "./VerifyBadge";
import { AnswerFacts } from "./AnswerFacts";
import type { ChatMsg } from "./chatTypes";

/** What the answer slot of a finished-or-running turn shows. */
export type TurnOutcome = "failed" | "stopped" | "answer" | "pending";

// "failed": the stream broke before any content. "stopped": stages ran but no
// answer arrived. A loaded message is always `done`, so it reads as "answer".
export function turnOutcome(msg: ChatMsg, streaming: boolean): TurnOutcome {
  if (!streaming && !msg.content && msg.failed) return "failed";
  if (msg.done && !msg.content && !msg.failed && (msg.stageLog ?? []).length > 0) return "stopped";
  return msg.generated || msg.done ? "answer" : "pending";
}

interface AnswerBodyProps {
  msg: ChatMsg;
  outcome: TurnOutcome;
  answerRef: RefObject<HTMLDivElement | null>;
  onAtlas: (uuid: string) => void;
}

// The failed note bypasses AtlasMarkdown so it can't pass for a terse reply.
// data-state is data only: restyling text on the verify flip reads as a jump.
export function AnswerBody({ msg, outcome, answerRef, onAtlas }: AnswerBodyProps) {
  if (outcome === "failed") {
    return (
      <div className="rlc-turn-error">
        <span className="rlc-turn-error-icon" aria-hidden="true">
          ⚠
        </span>{" "}
        This reply didn’t come through. Send another message to try again.
      </div>
    );
  }
  if (outcome === "stopped") return <p className="rlc-stopped">Stopped before an answer was ready.</p>;
  if (outcome === "pending") return null;
  const provisional = !msg.done || msg.verify?.status === "checking";
  return (
    <div ref={answerRef} className="rlc-answer" data-state={provisional ? "provisional" : "final"}>
      <AtlasMarkdown content={balanceFences(msg.content)} onAtlas={onAtlas} />
    </div>
  );
}

export function AnswerFooter({
  msg,
  onAtlas,
  collection,
}: {
  msg: ChatMsg;
  onAtlas: (uuid: string) => void;
  collection?: CollectionLink;
}) {
  return (
    <>
      {msg.verify && <VerifyBadge verify={msg.verify} onAtlas={onAtlas} />}
      <AnswerFacts coverage={msg.answerCoverage} marks={msg.citationMarks} />
      {msg.exports?.length ? <ExportChips exports={msg.exports} /> : null}
      {msg.done && <Sources sources={extractSources(msg.content)} marks={msg.citationMarks} collection={collection} onAtlas={onAtlas} />}
    </>
  );
}
