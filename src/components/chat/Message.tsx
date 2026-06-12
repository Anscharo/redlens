import { SparkMark } from "./glyphs";
import { AtlasMarkdown, balanceFences, extractSources } from "./markdown";
import { Sources } from "./Sources";
import { ToolTrace } from "./ToolTrace";
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
  const sources = msg.done ? extractSources(msg.content) : [];
  return (
    <div className="rlc-turn mb-[18px]">
      <div className="flex items-center gap-[7px] mb-[7px]">
        <SparkMark size={13} />
        <span className="rlc-agent-label">atlas agent</span>
      </div>
      {showTrace && <ToolTrace trace={msg.trace} rounds={msg.rounds} />}
      {streaming && empty ? (
        <div className="rlc-thinking">
          <span className="rlc-twinkle">✦</span> searching the stars…
        </div>
      ) : (
        <>
          <AtlasMarkdown content={streaming ? balanceFences(msg.content) : msg.content} onAtlas={onAtlas} />
          {streaming && <span className="rlc-caret" />}
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
