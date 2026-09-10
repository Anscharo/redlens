import { SparkMark } from "./glyphs";
import { AtlasMarkdown, balanceFences, extractSources } from "./markdown";
import { Sources } from "./Sources";
import { ExportChips } from "./ExportChips";
import { StageList, traceHeadline } from "./StageList";
import { renderStageSlot } from "./StageSlots";
import { useRevealOnDone } from "./useRevealOnDone";
import { VerifyBadge } from "./VerifyBadge";
import type { ChatMsg } from "./useChatStream";

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
}: {
  msg: ChatMsg;
  streaming: boolean;
  onAtlas: (uuid: string) => void;
}) {
  const stageLog = msg.stageLog ?? [];
  // The answer is revealed once `answer_final` (or an early `done` with no
  // `answer_final` before it) has landed — see useChatStream's `generated`.
  // A loaded/historical message has no stageLog and is always `done`, so it
  // takes this same branch without ever touching the checklist above it.
  const generated = msg.generated || msg.done;
  const { display, revealing } = useRevealOnDone(msg.content, generated);
  const sources = msg.done ? extractSources(msg.content) : [];
  // Italic while unchecked: not yet `done`, or checked but still auditing.
  // Flips to normal at `done` whether or not a verdict ever landed (verifier
  // off entirely never sets `verify` at all) — see Message.test.tsx for both.
  const provisional = !msg.done || msg.verify?.status === "checking";
  const failedEmpty = !streaming && !msg.content && msg.failed;
  // An aborted turn: stages ran, the turn ended, but no answer ever arrived.
  const stoppedEmpty = msg.done && !msg.content && !msg.failed && stageLog.length > 0;
  const summary = traceHeadline(msg.trace) + (msg.rounds > 1 ? ` · ${msg.rounds} rounds` : "");

  return (
    <div className="rlc-turn mb-[18px]">
      <div className="flex items-center gap-[7px] mb-[7px]">
        <SparkMark size={13} />
        <span className="rlc-agent-label">atlas agent</span>
      </div>
      {stageLog.length > 0 && (
        <StageList
          entries={stageLog}
          collapsed={msg.done}
          summary={summary}
          renderSlot={(entry, active) => renderStageSlot(msg, entry, active, onAtlas)}
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
              yet — chat.css italicizes it while "provisional". Message-level
              only: verification is per-answer, and claim→text alignment is
              too fuzzy to mark up per-span. */}
          <div className="rlc-answer" data-state={provisional ? "provisional" : "final"}>
            <AtlasMarkdown content={balanceFences(display)} onAtlas={onAtlas} />
          </div>
          {revealing && <span className="rlc-caret" />}
          {msg.verify && <VerifyBadge verify={msg.verify} onAtlas={onAtlas} />}
          {msg.exports?.length ? <ExportChips exports={msg.exports} /> : null}
          {msg.done && <Sources sources={sources} onAtlas={onAtlas} />}
        </>
      ) : null}
    </div>
  );
}

export function Message({
  msg,
  streaming,
  onAtlas,
}: {
  msg: ChatMsg;
  streaming: boolean;
  onAtlas: (uuid: string) => void;
}) {
  if (msg.role === "user") return <UserTurn text={msg.content} />;
  return <AssistantTurn msg={msg} streaming={streaming} onAtlas={onAtlas} />;
}
