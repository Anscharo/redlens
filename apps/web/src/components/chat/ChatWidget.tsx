import { useCallback, useState } from "react";
import { useLocation } from "wouter";
import { atlasHref } from "@/lib/routes";
import { ChatLauncher } from "./ChatLauncher";
import { ChatPanel } from "./ChatPanel";
import { useChatSession } from "./useChatSession";
import { usePageContext } from "./pageContext";
import { readFreshResume } from "./resume";
import { useChatOpenChannel } from "./useChatOpenChannel";
import { useResumeConversation, useResumeStamp } from "./useResume";
import { useAnchoredLayout, useChatHotkeys, useOpenState, usePlacement } from "./widgetHooks";
import "./chat.css";

// Top-level floating Atlas agent: launcher ↔ panel. Mounted once in the app
// shell so it's available on every route. Open via click or ⌘K / Ctrl-K; Esc
// closes. Two placements (persisted): "float" (docked corner card) and
// "anchored" (full-height right column that pushes the shell over).
//
// Conversation state (useChatSession) is owned HERE, not by ChatPanel, so
// closing the panel only unmounts its DOM — the thread, an in-flight stream,
// and the rate-limit lock all survive minimize/reopen.
//
// Reload-resume: the snapshot is read once on first render; a fresh one
// (chat was open < RESUME_WINDOW_MS ago) opens the panel immediately — no
// launcher flash — and useResumeConversation rehydrates its conversation.
export function ChatWidget() {
  const [resume] = useState(readFreshResume);
  const { open, setOpen, openChat, closeChat } = useOpenState(resume !== null);
  const [placement, togglePlacement] = usePlacement();
  const [, navigate] = useLocation();
  const context = usePageContext();
  const session = useChatSession(open);
  useResumeConversation(resume, session.openConversation);
  useResumeStamp(open, session.conversationId, session.title);
  useChatOpenChannel(session, setOpen);
  useChatHotkeys(openChat, closeChat);
  useAnchoredLayout(open, placement);
  // Atlas citation click → SPA-navigate to the reader, keep the panel open.
  const onAtlas = useCallback((uuid: string) => navigate(atlasHref(uuid)), [navigate]);
  if (!open) return <ChatLauncher onOpen={openChat} context={context} />;
  return (
    <ChatPanel
      session={session}
      onClose={closeChat}
      context={context}
      onAtlas={onAtlas}
      placement={placement}
      onTogglePlacement={togglePlacement}
    />
  );
}
