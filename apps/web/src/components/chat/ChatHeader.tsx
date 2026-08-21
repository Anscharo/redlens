import { SparkMark, DockRightIcon, FloatIcon } from "./glyphs";
import type { Placement } from "./types";

interface ChatHeaderProps {
  title: string | null; // conversation title; null for a fresh/untitled thread
  onNewChat: () => void;
  onClose: () => void;
  placement: Placement;
  onTogglePlacement: () => void;
  // Staged-delivery preference (docs/chat-system.md §8): pressed =
  // the user opted into stage-checklist turns; unpressed = follow the server
  // default (currently streaming).
  staged: boolean;
  onToggleStaged: () => void;
}

// Panel chrome: brand mark + conversation title (falls back to "Atlas" for a
// fresh thread) on the left, New chat / dock-toggle / close on the right.
// Split out of ChatPanel.tsx once the title became dynamic and the panel
// gained a New-chat action (chat-conversation-memory plan §7).
export function ChatHeader({ title, onNewChat, onClose, placement, onTogglePlacement, staged, onToggleStaged }: ChatHeaderProps) {
  const anchored = placement === "anchored";
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
          aria-pressed={staged}
          onClick={onToggleStaged}
          title="Staged answers (show steps, reveal the final answer once)"
          aria-label="Staged answers (show steps, reveal the final answer once)"
        >
          staged
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
