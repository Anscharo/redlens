import { SparkMark, DockRightIcon, FloatIcon } from "./glyphs";
import type { Placement } from "./types";

interface ChatHeaderProps {
  title: string | null; // conversation title; null for a fresh/untitled thread
  onNewChat: () => void;
  onClose: () => void;
  placement: Placement;
  onTogglePlacement: () => void;
  // Delivery-mode preference (docs/chat-system.md §8). `stages` is the
  // user-facing name for staged delivery (checklist, then reveal once);
  // unpressed / "streaming" follows the server default.
  stages: boolean;
  onToggleDelivery: () => void;
  // True for the whole in-flight SSE (tokens, verify, and any revision
  // replay). The pref is stamped onto the request/message at send time, so
  // flipping it mid-turn can't retarget the live stream.
  streaming: boolean;
}

export const DELIVERY_MODE_HINT = "set deliver mode: stream or stages";
export const DELIVERY_LOCKED_HINT = "can't change delivery mode while a reply is in progress";

// Panel chrome: brand mark + conversation title (falls back to "Atlas" for a
// fresh thread) on the left, New chat / dock-toggle / close on the right.
// Split out of ChatPanel.tsx once the title became dynamic and the panel
// gained a New-chat action (chat-conversation-memory plan §7).
export function ChatHeader({ title, onNewChat, onClose, placement, onTogglePlacement, stages, onToggleDelivery, streaming }: ChatHeaderProps) {
  const anchored = placement === "anchored";
  const deliveryHint = streaming ? DELIVERY_LOCKED_HINT : DELIVERY_MODE_HINT;
  return (
    <header className="rlc-header">
      <SparkMark size={15} />
      <div>
        <div className="rlc-header-title">{title ?? "Atlas"}</div>
        <div className="rlc-header-sub">page-aware agent</div>
      </div>
      <div className="ml-auto flex items-center gap-1">
        <button
          className="rlc-staged-toggle"
          aria-pressed={stages}
          onClick={onToggleDelivery}
          disabled={streaming}
          title={deliveryHint}
          aria-label={deliveryHint}
        >
          {stages ? "stages" : "streaming"}
        </button>
        <button className="rlc-iconbtn" onClick={onNewChat} title="New chat" aria-label="New chat">
          +
        </button>
        <button
          className="rlc-iconbtn"
          onClick={onTogglePlacement}
          title={anchored ? "Pop out to a floating window" : "Dock to the side"}
          aria-label={anchored ? "Pop out to a floating window" : "Dock to the side"}
        >
          {anchored ? <FloatIcon /> : <DockRightIcon />}
        </button>
        <button className="rlc-iconbtn" onClick={onClose} title="Close" aria-label="Close">
          ×
        </button>
      </div>
    </header>
  );
}
