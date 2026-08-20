import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { atlasHref } from "@/lib/routes";
import { useChatOpenOptional } from "@/lib/chatOpen";
import { ChatLauncher } from "./ChatLauncher";
import { ChatPanel } from "./ChatPanel";
import { useChatSession } from "./useChatSession";
import { usePageContext } from "./pageContext";
import { track } from "@/lib/analytics";
import { clearResume, readFreshResume, writeResume, type ResumeSnapshot } from "./resume";
import type { Placement } from "./types";
import "./chat.css";

const PLACEMENT_KEY = "rlc-placement";

function readPlacement(): Placement {
  return localStorage.getItem(PLACEMENT_KEY) === "anchored" ? "anchored" : "float";
}

// Top-level floating Atlas agent: launcher ↔ panel. Mounted once in the app
// shell so it's available on every route. Open via click or ⌘K / Ctrl-K; Esc
// closes. Two placements (persisted): "float" (docked corner card) and
// "anchored" (full-height right column that pushes the shell over — see the
// body.rlc-anchored .app-shell rule in chat.css).
//
// Conversation state (useChatSession) is owned HERE, not by ChatPanel, so
// closing the panel only unmounts its DOM — the thread, an in-flight stream,
// and the rate-limit lock all survive minimize/reopen (chat-conversation-
// memory plan §5: lift the state out, don't wrap the app in a provider).
export function ChatWidget() {
  // Reload-resume (resume.ts): read once on first render; a fresh snapshot
  // (chat was open < RESUME_WINDOW_MS ago) opens the panel immediately — no
  // launcher flash — and the mount effect below rehydrates its conversation.
  const resumeRef = useRef<ResumeSnapshot | null | undefined>(undefined);
  if (resumeRef.current === undefined) resumeRef.current = readFreshResume();
  const [open, setOpen] = useState(resumeRef.current !== null);
  const [placement, setPlacement] = useState<Placement>(readPlacement);
  const [, navigate] = useLocation();
  const context = usePageContext();
  const session = useChatSession(open);
  const chatOpen = useChatOpenOptional();
  const request = chatOpen?.request ?? null;
  const deleted = chatOpen?.deleted ?? null;
  const lastHandledNonceRef = useRef(0);
  const lastHandledDeleteRef = useRef(0);
  const { openConversation, newChat, conversationId } = session;

  // Track each open once (guards ⌘K while already open). product:"chat" overrides
  // the route-derived super property since the widget overlays any page.
  const openChat = useCallback(() => {
    setOpen((o) => {
      if (!o) track("chat_open", { product: "chat" });
      return true;
    });
  }, []);

  // An explicit close is a decision — a reload right after must NOT reopen,
  // so it clears the snapshot along with closing.
  const closeChat = useCallback(() => {
    setOpen(false);
    clearResume();
  }, []);

  // Finish the resume: reopen the same conversation the refresh interrupted.
  // Runs once (the ref is consumed); a stale/deleted id degrades to a fresh
  // chat inside openConversation's own catch.
  useEffect(() => {
    const r = resumeRef.current;
    if (!r) return;
    resumeRef.current = null;
    track("chat_open", { product: "chat", resumed: true });
    if (r.conversationId) void openConversation(r.conversationId, r.title);
  }, [openConversation]);

  // While open, keep the snapshot current (open + which conversation), and
  // re-stamp it on pagehide — the reliable "page is going away" signal — so
  // `at` reflects the moment of the reload, not the last state change.
  useEffect(() => {
    if (!open) return;
    const stamp = () => writeResume({ at: Date.now(), conversationId, title: session.title });
    stamp();
    window.addEventListener("pagehide", stamp);
    return () => window.removeEventListener("pagehide", stamp);
  }, [open, conversationId, session.title]);

  // Cross-route command channel (src/lib/chatOpen.tsx): another page (e.g. a
  // conversation list row) asked to open a specific conversation here.
  // Compare by `nonce`, not `conversationId` — re-clicking the SAME
  // conversation after minimizing must still re-fire, which an id-only
  // comparison would swallow as "no change".
  useEffect(() => {
    if (!request || request.nonce === lastHandledNonceRef.current) return;
    lastHandledNonceRef.current = request.nonce;
    setOpen(true);
    void openConversation(request.conversationId, request.title);
  }, [request, openConversation]);

  // A page deleted a conversation. If it's the one loaded here, reset to a
  // fresh chat: the row is gone from the DB, so the next send would otherwise
  // POST a dead id. (useChatStream's conversation_not_found branch is the
  // second line of defense, for a delete that happened in another tab.)
  useEffect(() => {
    if (!deleted || deleted.nonce === lastHandledDeleteRef.current) return;
    lastHandledDeleteRef.current = deleted.nonce;
    if (deleted.conversationId === conversationId) newChat();
  }, [deleted, conversationId, newChat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openChat();
      } else if (e.key === "Escape") {
        closeChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openChat, closeChat]);

  // Drive the layout push: only when anchored AND open does the shell reserve a
  // right gutter. Cleared on close, placement change, or unmount.
  useEffect(() => {
    const anchoredOpen = open && placement === "anchored";
    document.body.classList.toggle("rlc-anchored", anchoredOpen);
    return () => document.body.classList.remove("rlc-anchored");
  }, [open, placement]);

  const togglePlacement = useCallback(() => {
    setPlacement((p) => {
      const next: Placement = p === "float" ? "anchored" : "float";
      localStorage.setItem(PLACEMENT_KEY, next);
      return next;
    });
  }, []);

  // Atlas citation click → SPA-navigate to the reader, keep the panel open.
  const onAtlas = useCallback(
    (uuid: string) => {
      navigate(atlasHref(uuid));
    },
    [navigate],
  );

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
