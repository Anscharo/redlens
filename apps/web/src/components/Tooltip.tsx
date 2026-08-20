import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: ReactNode;
  delay?: number;
  children: ReactElement;
}

const HIDE_GRACE_MS = 120;

// Module-level singleton — only one tooltip is open at a time. When a tooltip
// shows, it calls the previously-open tooltip's hide function before claiming
// the slot. Each tooltip clears the slot on hide.
let activeHide: (() => void) | null = null;

interface Placement {
  left: number;
  top: number;
  maxHeight: number;
  placed: boolean;
}

const INITIAL: Placement = { left: 0, top: 0, maxHeight: 0, placed: false };

export function Tooltip({ content, delay = 800, children }: TooltipProps) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<Placement>(INITIAL);

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    const tip = tipRef.current;
    if (!r || !tip) return;
    const margin = 8;
    const edge = 8;
    // Measure natural size with constraints relaxed.
    tip.style.maxHeight = "none";
    const tipW = tip.offsetWidth;
    const naturalH = tip.offsetHeight;
    const spaceAbove = r.top - margin - edge;
    const spaceBelow = window.innerHeight - r.bottom - margin - edge;
    const fitsAbove = naturalH <= spaceAbove;
    const fitsBelow = naturalH <= spaceBelow;
    // Prefer above; flip to below if it fits there but not above; otherwise
    // take whichever side has more vertical room.
    const placeAbove = fitsAbove ? true : fitsBelow ? false : spaceAbove >= spaceBelow;
    const maxHeight = Math.max(60, placeAbove ? spaceAbove : spaceBelow);
    const h = Math.min(naturalH, maxHeight);
    const top = placeAbove ? r.top - h - margin : r.bottom + margin;
    let left = r.left + r.width / 2 - tipW / 2;
    left = Math.max(edge, Math.min(left, window.innerWidth - tipW - edge));
    setPos({ left, top, maxHeight, placed: true });
  }, []);

  // Stable handle to the latest hideNow so timer callbacks (which may outlive
  // the closures they were created in) and the module-level activeHide slot
  // both refer to a single, current function.
  const hideRef = useRef<() => void>(() => {});

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    // Cancel any pending show so a quick hover-and-leave doesn't open the
    // tooltip later when the mouse is somewhere else entirely.
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      if (activeHide === hideRef.current) activeHide = null;
      setVisible(false);
    }, HIDE_GRACE_MS);
  }, [cancelHide]);

  const hideNow = useCallback(() => {
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    cancelHide();
    if (activeHide === hideRef.current) activeHide = null;
    setVisible(false);
  }, [cancelHide]);
  hideRef.current = hideNow;

  const show = useCallback(() => {
    cancelHide();
    if (visible) return;
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => {
      if (activeHide && activeHide !== hideRef.current) activeHide();
      activeHide = hideRef.current;
      setVisible(true);
    }, delay);
  }, [delay, visible, cancelHide]);

  // Reset placement state every time we hide so the next show measures fresh.
  useEffect(() => {
    if (!visible) setPos(INITIAL);
  }, [visible]);

  useLayoutEffect(() => {
    if (visible) place();
  }, [visible, place, content]);

  useEffect(() => {
    if (!visible) return;
    const onScroll = (e: Event) => {
      if (tipRef.current && tipRef.current.contains(e.target as Node)) return;
      hideNow();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", hideNow);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", hideNow);
    };
  }, [visible, hideNow]);

  useEffect(() => () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (activeHide === hideRef.current) activeHide = null;
  }, []);

  if (!isValidElement(children) || content == null || content === false) {
    return children;
  }

  const setRef: Ref<HTMLElement> = (n) => {
    triggerRef.current = n;
  };

  const child = cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: setRef,
    onMouseEnter: show,
    onMouseLeave: scheduleHide,
    onFocus: show,
    onBlur: hideNow,
  });

  return (
    <>
      {child}
      {visible && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            zIndex: 50,
            visibility: pos.placed ? "visible" : "hidden",
            maxWidth: "calc(100vw - 16px)",
            maxHeight: pos.maxHeight || undefined,
            overflowX: "hidden",
            overflowY: "auto",
            padding: "6px 8px",
            background: "var(--surface)",
            color: "var(--tan)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 11,
            lineHeight: 1.45,
            boxShadow: "0 4px 12px var(--shadow-strong)",
          }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
