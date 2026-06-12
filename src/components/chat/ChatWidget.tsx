import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { atlasHref } from "../../lib/routes";
import { ChatLauncher } from "./ChatLauncher";
import { ChatPanel } from "./ChatPanel";
import { usePageContext } from "./pageContext";
import "./chat.css";

export type Placement = "float" | "anchored";
const PLACEMENT_KEY = "rlc-placement";

function readPlacement(): Placement {
  return localStorage.getItem(PLACEMENT_KEY) === "anchored" ? "anchored" : "float";
}

// Top-level floating Atlas agent: launcher ↔ panel. Mounted once in the app
// shell so it's available on every route. Open via click or ⌘K / Ctrl-K; Esc
// closes. Two placements (persisted): "float" (docked corner card) and
// "anchored" (full-height right column that pushes the shell over — see the
// body.rlc-anchored .app-shell rule in chat.css). The panel unmounts when
// closed — every open starts fresh (MVP; the v1 history list will change this).
export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement>(readPlacement);
  const [, navigate] = useLocation();
  const context = usePageContext();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  if (!open) return <ChatLauncher onOpen={() => setOpen(true)} context={context} />;
  return (
    <ChatPanel
      onClose={() => setOpen(false)}
      context={context}
      onAtlas={onAtlas}
      placement={placement}
      onTogglePlacement={togglePlacement}
    />
  );
}
