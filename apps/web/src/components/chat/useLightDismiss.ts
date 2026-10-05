import { useCallback, useEffect, useState, type RefObject } from "react";

// Light-dismiss for a popup: while `active`, a press anywhere OUTSIDE `ref`
// calls `onOutside`. Presses inside are left to the popup's own controls.
// `type` is the press event each caller listens for (`mousedown` for the nav
// menus, `pointerdown` for the limits popover). Listeners exist only while
// active — outside-dismiss is the one thing CSS can't do here.
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

// While `active`, Escape on `target` calls `onEscape` with the event, so a
// caller that owns the key can preventDefault it.
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
  /** The outside-press event that dismisses (see useOutsidePress). */
  press?: "mousedown" | "pointerdown";
  /** Where Escape is listened for. */
  escapeTarget?: Window | Document;
  /** Claim the Escape key (preventDefault) when it closes the popover. */
  claimEscape?: boolean;
}

// Open/closed state for a click-toggled popover anchored in `ref`, closed by
// a press outside it or by Escape.
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
