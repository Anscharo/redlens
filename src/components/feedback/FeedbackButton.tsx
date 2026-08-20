import { useEffect, useRef, useState } from "react";
import { isTypingTarget } from "@/lib/shortcuts";
import { usePageContext } from "../chat/pageContext";
import { track } from "@/lib/analytics";
import { FeedbackModal } from "./FeedbackModal";

// Nav "?" button: opens the feedback modal. Also bound to a global "?"
// keypress, mirroring ChatWidget's ⌘K handler (ChatWidget.tsx ~L73-84).
// Note: SearchBar's input has autoFocus, so "?" only fires once focus has
// left it — accepted, the button is the primary affordance.
//
// data-feedback-ui marks this out of the interaction trail
// (src/lib/lastInteraction.ts), so the click that opens the modal is never
// recorded as "what the user was doing beforehand".
//
// button { font: inherit } isn't in index.css's global reset, so
// `font-[inherit]` here keeps the glyph matching the sibling nav links.
export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const { path } = usePageContext();
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "?") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      track("feedback_open", { path: pathRef.current });
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          track("feedback_open", { path });
          setOpen(true);
        }}
        className="nav-link shrink-0 px-3 py-1.5 rounded text-sm font-[inherit]"
        data-feedback-ui
        aria-label="Send feedback"
        title="Send feedback (?)"
      >
        ?
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}
