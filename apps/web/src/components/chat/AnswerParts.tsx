import type { RefObject } from "react";
import { AtlasMarkdown, balanceFences, extractSources } from "./markdown";
import { Sources } from "./Sources";
import { ExportChips } from "./ExportChips";
import { VerifyBadge } from "./VerifyBadge";
import { AnswerFacts } from "./AnswerFacts";
import type { ChatMsg } from "./chatTypes";

/** What the answer slot of a finished-or-running turn shows. */
export type TurnOutcome = "failed" | "stopped" | "answer" | "pending";

// "failed": the stream broke (SSE "error" event or a fetch/read exception)
// before any content arrived. "stopped": stages ran and the turn ended, but no
// answer ever arrived. "answer": revealed — `answer_final`, or an early `done`
// with no `answer_final` before it (see useChatStream's `generated`); a
// loaded/historical message has no stageLog and is always `done`, so it takes
// this branch too.
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

// The failed note is plain copy, never run through AtlasMarkdown, so it can
// never be mistaken for a real (if terse) assistant reply. The answer's
// data-state says whether it has cleared verification yet — unchecked while
// not `done` or still auditing. Carried as data only: nothing restyles the
// text on the flip (an italic→upright change read as the answer "jumping");
// the verify badge is the signal. Message-level only: verification is
// per-answer, and claim→text alignment is too fuzzy to mark up per-span.
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

// Under a revealed answer: the verify badge, then directly after it the
// answer's facts (together they are its confidence — contradictions,
// coverage, sources backed), exported files, and the Sources cluster once
// the turn is done.
export function AnswerFooter({ msg, onAtlas }: { msg: ChatMsg; onAtlas: (uuid: string) => void }) {
  return (
    <>
      {msg.verify && <VerifyBadge verify={msg.verify} onAtlas={onAtlas} />}
      <AnswerFacts coverage={msg.answerCoverage} marks={msg.citationMarks} />
      {msg.exports?.length ? <ExportChips exports={msg.exports} /> : null}
      {msg.done && <Sources sources={extractSources(msg.content)} marks={msg.citationMarks} onAtlas={onAtlas} />}
    </>
  );
}
