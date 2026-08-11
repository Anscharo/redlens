import { SparkMark } from "./glyphs";
import { AtlasMarkdown, balanceFences, extractSources } from "./markdown";
import { Sources } from "./Sources";
import { ExportChips } from "./ExportChips";
import { StageList } from "./StageList";
import { ToolTrace } from "./ToolTrace";
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
  showTrace,
  onAtlas,
}: {
  msg: ChatMsg;
  streaming: boolean;
  showTrace: boolean;
  onAtlas: (uuid: string) => void;
}) {
  const empty = !msg.content;
  const stageLog = msg.stageLog ?? [];
  const { display, revealing } = useRevealOnDone(msg.content, msg.done);
  const sources = msg.done ? extractSources(msg.content) : [];

  // Staged mode never streams tokens, so content stays empty until `done` —
  // once the checklist's own !done guard flips (done arrives), it stops being
  // eligible regardless of `revealing`, which is what "suppress the stage
  // list while revealing" reduces to. The explicit delivery gate keeps the
  // DEFAULT streaming mode visually unchanged pre-first-token (its old
  // placeholder ticker) until the staged A/B measures — stageLog accumulates
  // in both modes, so without the gate the checklist would leak into
  // streaming's pre-token window. `undefined` (no meta yet / older server)
  // counts as non-streaming so staged tests and aborts still render stages.
  const notStreamingMode = msg.delivery !== "streaming";
  const showChecklist = notStreamingMode && !msg.done && empty && stageLog.length > 0;
  // An aborted staged turn: done, still no answer, but stages ran — a blank
  // bubble would look broken rather than intentionally stopped.
  const stoppedEmpty = notStreamingMode && msg.done && empty && stageLog.length > 0;
  const shownContent = !msg.done ? balanceFences(msg.content) : revealing ? balanceFences(display) : display;

  return (
    <div className="rlc-turn mb-[18px]">
      <div className="flex items-center gap-[7px] mb-[7px]">
        <SparkMark size={13} />
        <span className="rlc-agent-label">atlas agent</span>
      </div>
      {showTrace && <ToolTrace trace={msg.trace} rounds={msg.rounds} />}
      {showChecklist ? (
        <StageList entries={stageLog} />
      ) : streaming && empty ? (
        <div className="rlc-thinking">
          <span className="rlc-twinkle">✦</span> {msg.statusLine ?? "searching the stars…"}
        </div>
      ) : !streaming && empty && msg.failed ? (
        // The stream broke (SSE "error" event or a fetch/read exception) before
        // any content arrived — say so plainly instead of leaving a silent,
        // answer-shaped blank. Not run through AtlasMarkdown so it can never be
        // mistaken for a real (if terse) assistant reply. Ranked above the
        // staged "stopped" row: a failed staged turn is an error, not a stop.
        <div className="rlc-turn-error">
          <span className="rlc-turn-error-icon" aria-hidden="true">
            ⚠
          </span>{" "}
          This reply didn’t come through. Send another message to try again.
        </div>
      ) : stoppedEmpty ? (
        <p className="rlc-stopped">Stopped before an answer was ready.</p>
      ) : (
        <>
          <AtlasMarkdown content={shownContent} onAtlas={onAtlas} />
          {(streaming || revealing) && <span className="rlc-caret" />}
          {streaming && msg.statusLine && (
            <div className="rlc-thinking rlc-statusline">
              <span className="rlc-twinkle">✦</span> {msg.statusLine}
            </div>
          )}
          {msg.verify && <VerifyBadge verify={msg.verify} />}
          {msg.exports?.length ? <ExportChips exports={msg.exports} /> : null}
          {!streaming && msg.done && <Sources sources={sources} onAtlas={onAtlas} />}
        </>
      )}
    </div>
  );
}

export function Message({
  msg,
  streaming,
  showTrace,
  onAtlas,
}: {
  msg: ChatMsg;
  streaming: boolean;
  showTrace: boolean;
  onAtlas: (uuid: string) => void;
}) {
  if (msg.role === "user") return <UserTurn text={msg.content} />;
  return <AssistantTurn msg={msg} streaming={streaming} showTrace={showTrace} onAtlas={onAtlas} />;
}
