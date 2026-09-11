import { Link, useLocation } from "wouter";
import { ROUTES } from "@/lib/routes";
import { SparkMark, DockRightIcon, FloatIcon, ConversationsIcon } from "./glyphs";
import type { Placement } from "./types";

interface ChatHeaderProps {
  title: string | null; // conversation title; null for a fresh/untitled thread
  onNewChat: (() => void) | null; // null hides the button (thread already empty — nothing to start over from)
  onClose: () => void;
  placement: Placement;
  onTogglePlacement: () => void;
}

// Panel chrome, left to right: a link to the Conversations page, brand mark,
// conversation title (falls back to "Atlas" for a fresh thread), New chat
// beside it (only once there is a thread to leave); dock-toggle / close on
// the right.
// Split out of ChatPanel.tsx once the title became dynamic and the panel
// gained a New-chat action (chat-conversation-memory plan §7).
export function ChatHeader({ title, onNewChat, onClose, placement, onTogglePlacement }: ChatHeaderProps) {
  const anchored = placement === "anchored";
  const [path] = useLocation();
  const onConversations = path === ROUTES.CONVERSATIONS;
  return (
    <header className="rlc-header">
      {/* A link to the page you are already on does nothing when clicked, so
          on /conversations it becomes a disabled button — same footprint,
          no dead click. */}
      {onConversations ? (
        <button className="rlc-iconbtn" disabled title="Conversations (this page)" aria-label="Conversations (this page)">
          <ConversationsIcon />
        </button>
      ) : (
        <Link className="rlc-iconbtn" to={ROUTES.CONVERSATIONS} title="Conversations" aria-label="Conversations">
          <ConversationsIcon />
        </Link>
      )}
      <SparkMark size={15} />
      <div>
        <div className="rlc-header-title">{title ?? "Atlas"}</div>
        <div className="rlc-header-sub">page-aware agent</div>
      </div>
      {onNewChat && (
        <button className="rlc-iconbtn" onClick={onNewChat} title="New chat" aria-label="New chat">
          +
        </button>
      )}
      <div className="ml-auto flex items-center gap-1">
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
