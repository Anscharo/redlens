import { useCallback, useEffect, useState, type RefObject } from "react";

// While `active`, a press outside `ref` calls `onOutside`.
export function useOutsidePress(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
  type: "mousedown" | "pointerdown" = "mousedown",
) {
  useEffect(() => {
    if (!active) return;
    const onPress = (e: Event) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) onOutside();
    };
    document.addEventListener(type, onPress);
    return () => document.removeEventListener(type, onPress);
  }, [ref, active, onOutside, type]);
}

// Passes the event so a caller that owns Escape can preventDefault it.
export function useEscapeKey(active: boolean, onEscape: (e: KeyboardEvent) => void, target: Window | Document = document) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: Event) => {
      if ((e as KeyboardEvent).key === "Escape") onEscape(e as KeyboardEvent);
    };
    target.addEventListener("keydown", onKey);
    return () => target.removeEventListener("keydown", onKey);
  }, [active, onEscape, target]);
}

interface PopoverOptions {
  press?: "mousedown" | "pointerdown";
  escapeTarget?: Window | Document;
  /** Claim the Escape key (preventDefault) when it closes the popover. */
  claimEscape?: boolean;
}

// A click-toggled popover closed by an outside press or Escape.
export function useDismissiblePopover(ref: RefObject<HTMLElement | null>, { press, escapeTarget, claimEscape = false }: PopoverOptions = {}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const onEscape = useCallback(
    (e: KeyboardEvent) => {
      if (claimEscape) e.preventDefault();
      setOpen(false);
    },
    [claimEscape],
  );
  useOutsidePress(ref, open, close, press);
  useEscapeKey(open, onEscape, escapeTarget);
  return [open, setOpen] as const;
}
