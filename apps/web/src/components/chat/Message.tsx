import { useLayoutEffect, useRef } from "react";
import { SparkMark } from "./glyphs";
import { AtlasMarkdown, balanceFences, extractSources } from "./markdown";
import { Sources } from "./Sources";
import { ExportChips } from "./ExportChips";
import { StageList, traceHeadline } from "./StageList";
import { StageSlot } from "./StageSlot";
import { stageSlotContent } from "./stageSlotContent";
import { VerifyBadge } from "./VerifyBadge";
import type { ChatMsg, StageLogEntry } from "./useChatStream";

// The stages that run on the answer once it exists. Their rows render AFTER
// the answer, so the answer sits directly under the Synthesizing row — the
// place the reader was watching it form — and nothing already on screen
// moves when these rows arrive or when the answer lands between them.
const POST_ANSWER_STAGES = new Set(["comparing", "checking"]);
const POST_ANSWER_SUMMARY = "compared and verified";

function UserTurn({ text }: { text: string }) {
  return (
    <div className="rlc-turn flex justify-end mb-4">
      <div className="max-w-[85%]">
        <div className="rlc-user-label mb-1">you</div>
        <div className="rlc-user-bubble">{text}</div>
      </div>
    </div>
  );
}

function AssistantTurn({
  msg,
  streaming,
  onAtlas,
  onAnswerReveal,
}: {
  msg: ChatMsg;
  streaming: boolean;
  onAtlas: (uuid: string) => void;
  onAnswerReveal?: (el: HTMLElement) => void;
}) {
  const stageLog = msg.stageLog ?? [];
  const preStages = stageLog.filter((e) => !POST_ANSWER_STAGES.has(e.stage));
  const postStages = stageLog.filter((e) => POST_ANSWER_STAGES.has(e.stage));
  const activeAt = stageLog[stageLog.length - 1]?.at;
  // The answer is revealed once `answer_final` (or an early `done` with no
  // `answer_final` before it) has landed — see useChatStream's `generated`.
  // A loaded/historical message has no stageLog and is always `done`, so it
  // takes this same branch without ever touching the checklist above it.
  const generated = msg.generated || msg.done;
  const sources = msg.done ? extractSources(msg.content) : [];
  // Unchecked: not yet `done`, or checked but still auditing. Carried as
  // data-state only — nothing restyles the text on the flip (an italic→
  // upright change read as the answer "jumping"); the verify badge is the
  // signal. See Message.test.tsx for both transitions.
  const provisional = !msg.done || msg.verify?.status === "checking";

  // The reveal is the one moment the answer's height lands all at once, in
  // the same commit that hides the live draft in the synthesizing row. Tell
  // the thread so it can show the answer from its first line. Transition
  // only (prev-ref): a hydrated message mounts with `generated` already
  // true and must open at the bottom like any loaded thread.
  const answerRef = useRef<HTMLDivElement>(null);
  const prevGeneratedRef = useRef(generated);
  useLayoutEffect(() => {
    const was = prevGeneratedRef.current;
    prevGeneratedRef.current = generated;
    if (generated && !was && msg.content && answerRef.current) onAnswerReveal?.(answerRef.current);
  }, [generated, msg.content, onAnswerReveal]);
  const failedEmpty = !streaming && !msg.content && msg.failed;
  // An aborted turn: stages ran, the turn ended, but no answer ever arrived.
  const stoppedEmpty = msg.done && !msg.content && !msg.failed && stageLog.length > 0;
  const summary = traceHeadline(msg.trace);
  // null for a stage with nothing to disclose — StageList renders that row
  // as plain text instead of a disclosure button.
  const slotFor = (entry: StageLogEntry) => {
    const content = stageSlotContent(msg, entry);
    return content && <StageSlot content={content} onAtlas={onAtlas} />;
  };

  return (
    <div className="rlc-turn mb-[18px]">
      <div className="flex items-center gap-[7px] mb-[7px]">
        <SparkMark size={13} />
        <span className="rlc-agent-label">atlas agent</span>
      </div>
      {preStages.length > 0 && (
        <StageList
          entries={preStages}
          collapsed={msg.done}
          summary={summary}
          activeAt={activeAt}
          renderSlot={slotFor}
        />
      )}
      {/* Pre-first-stage window only — once a stage row exists the checklist
          above is the "something's happening" signal instead. */}
      {streaming && stageLog.length === 0 && (
        <div className="rlc-thinking">
          <span className="rlc-twinkle">✦</span> {msg.statusLine ?? "searching the stars…"}
        </div>
      )}
      {failedEmpty ? (
        // The stream broke (SSE "error" event or a fetch/read exception) before
        // any content arrived — say so plainly instead of leaving a silent,
        // answer-shaped blank. Not run through AtlasMarkdown so it can never be
        // mistaken for a real (if terse) assistant reply.
        <div className="rlc-turn-error">
          <span className="rlc-turn-error-icon" aria-hidden="true">
            ⚠
          </span>{" "}
          This reply didn’t come through. Send another message to try again.
        </div>
      ) : stoppedEmpty ? (
        <p className="rlc-stopped">Stopped before an answer was ready.</p>
      ) : generated ? (
        <>
          {/* data-state carries whether this answer has cleared verification
              yet. Message-level only: verification is per-answer, and
              claim→text alignment is too fuzzy to mark up per-span. */}
          <div ref={answerRef} className="rlc-answer" data-state={provisional ? "provisional" : "final"}>
            <AtlasMarkdown content={balanceFences(msg.content)} onAtlas={onAtlas} />
          </div>
        </>
      ) : null}
      {postStages.length > 0 && (
        <StageList
          entries={postStages}
          collapsed={msg.done}
          summary={POST_ANSWER_SUMMARY}
          activeAt={activeAt}
          renderSlot={slotFor}
        />
      )}
      {generated && !failedEmpty && !stoppedEmpty && (
        <>
          {msg.verify && <VerifyBadge verify={msg.verify} onAtlas={onAtlas} />}
          {msg.exports?.length ? <ExportChips exports={msg.exports} /> : null}
          {msg.done && <Sources sources={sources} onAtlas={onAtlas} />}
        </>
      )}
    </div>
  );
}

export function Message({
  msg,
  streaming,
  onAtlas,
  onAnswerReveal,
}: {
  msg: ChatMsg;
  streaming: boolean;
  onAtlas: (uuid: string) => void;
  // Called once, with the answer element, when this turn's answer is revealed.
  onAnswerReveal?: (el: HTMLElement) => void;
}) {
  if (msg.role === "user") return <UserTurn text={msg.content} />;
  return <AssistantTurn msg={msg} streaming={streaming} onAtlas={onAtlas} onAnswerReveal={onAnswerReveal} />;
}
