import { useCallback, useEffect, useState } from "react";
import { track } from "../../lib/analytics";
import { clearResume } from "./resume";
import type { Placement } from "./types";

const PLACEMENT_KEY = "rlc-placement";

function readPlacement(): Placement {
  return localStorage.getItem(PLACEMENT_KEY) === "anchored" ? "anchored" : "float";
}

// Panel open/closed. Each open is tracked once (guards ⌘K while already
// open); product:"chat" overrides the route-derived super property since the
// widget overlays any page. An explicit close is a decision — a reload right
// after must NOT reopen, so it clears the resume snapshot along with closing.
export function useOpenState(initiallyOpen: boolean) {
  const [open, setOpen] = useState(initiallyOpen);
  const openChat = useCallback(() => {
    setOpen((o) => {
      if (!o) track("chat_open", { product: "chat" });
      return true;
    });
  }, []);
  const closeChat = useCallback(() => {
    setOpen(false);
    clearResume();
  }, []);
  return { open, setOpen, openChat, closeChat };
}

// "float" (docked corner card) or "anchored" (full-height right column),
// persisted across reloads.
export function usePlacement() {
  const [placement, setPlacement] = useState<Placement>(readPlacement);
  const togglePlacement = useCallback(() => {
    setPlacement((p) => {
      const next: Placement = p === "float" ? "anchored" : "float";
      localStorage.setItem(PLACEMENT_KEY, next);
      return next;
    });
  }, []);
  return [placement, togglePlacement] as const;
}

// ⌘K / Ctrl-K opens the panel from anywhere; Escape closes it.
export function useChatHotkeys(openChat: () => void, closeChat: () => void) {
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
}

// Drives the layout push: only when anchored AND open does the shell reserve
// a right gutter (the body.rlc-anchored .app-shell rule in chat.css). Cleared
// on close, placement change, or unmount.
export function useAnchoredLayout(open: boolean, placement: Placement) {
  useEffect(() => {
    document.body.classList.toggle("rlc-anchored", open && placement === "anchored");
    return () => document.body.classList.remove("rlc-anchored");
  }, [open, placement]);
}
