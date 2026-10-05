import { useEffect, useRef } from "react";
import { track } from "../../lib/analytics";
import { writeResume, type ResumeSnapshot } from "./resume";
import type { ChatSession } from "./useChatSession";

// Reload-resume (resume.ts), first half: reopen the conversation a refresh
// interrupted. Runs once (the snapshot is consumed); a stale/deleted id
// degrades to a fresh chat inside openConversation's own catch.
export function useResumeConversation(resume: ResumeSnapshot | null, openConversation: ChatSession["openConversation"]) {
  const pendingRef = useRef(resume);
  useEffect(() => {
    const r = pendingRef.current;
    if (!r) return;
    pendingRef.current = null;
    track("chat_open", { product: "chat", resumed: true });
    if (r.conversationId) void openConversation(r.conversationId, r.title);
  }, [openConversation]);
}

// Second half: while open, keep the snapshot current (open + which
// conversation), and re-stamp it on pagehide — the reliable "page is going
// away" signal — so `at` reflects the moment of the reload, not the last
// state change.
export function useResumeStamp(open: boolean, conversationId: string | null, title: string | null) {
  useEffect(() => {
    if (!open) return;
    const stamp = () => writeResume({ at: Date.now(), conversationId, title });
    stamp();
    window.addEventListener("pagehide", stamp);
    return () => window.removeEventListener("pagehide", stamp);
  }, [open, conversationId, title]);
}
