import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { useResizeDrag } from "../../hooks/useResizeDrag";
import {
  ANCHORED_MIN_PX,
  ANCHORED_NARROW_PX,
  ANCHORED_WIDTH_KEY,
  ANCHORED_KEYBOARD_STEP_PX,
  anchoredMaxPx,
  clampAnchoredWidth,
  readStoredAnchoredWidth,
  writeStoredAnchoredWidth,
} from "./anchoredWidth";

function useViewportWidth(): number {
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return vw;
}

// --rlc-anchored-w is read by the panel, the shell's right padding and the footer.
function useAnchoredWidthVar(applied: number | null, narrow: boolean) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (applied == null || narrow) {
      root.style.removeProperty("--rlc-anchored-w");
      return;
    }
    root.style.setProperty("--rlc-anchored-w", `${applied}px`);
    // Braced: removeProperty returns a string, not a valid effect destructor.
    return () => {
      root.style.removeProperty("--rlc-anchored-w");
    };
  }, [applied, narrow]);
}

// Measured, not stored: persisting the CSS clamp would freeze a responsive default into a pixel.
function useMeasuredWidth(handleRef: RefObject<HTMLDivElement | null>, preferred: number | null, vw: number): number {
  const [measured, setMeasured] = useState(ANCHORED_MIN_PX);
  useLayoutEffect(() => {
    if (preferred != null) return;
    const w = handleRef.current?.parentElement?.offsetWidth ?? 0;
    if (w >= ANCHORED_MIN_PX) setMeasured((prev) => (prev === w ? prev : w));
  }, [handleRef, preferred, vw]);
  return measured;
}

// body.rlc-resizing suppresses transitions while the width moves.
function useResizingClass(startResize: (e: MouseEvent) => void) {
  const dragging = useRef(false);
  useEffect(() => () => document.body.classList.remove("rlc-resizing"), []);
  const onMouseDown = useCallback(
    (e: MouseEvent) => {
      dragging.current = true;
      document.body.classList.add("rlc-resizing");
      const onUp = () => {
        dragging.current = false;
        document.body.classList.remove("rlc-resizing");
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mouseup", onUp);
      startResize(e);
    },
    [startResize],
  );
  return { dragging, onMouseDown };
}

// Left widens: the handle is on the left edge.
function keyTarget(key: string, shown: number, max: number): number | null {
  if (key === "ArrowLeft") return shown + ANCHORED_KEYBOARD_STEP_PX;
  if (key === "ArrowRight") return shown - ANCHORED_KEYBOARD_STEP_PX;
  if (key === "Home") return ANCHORED_MIN_PX;
  return key === "End" ? max : null;
}

function useKeyboardResize(shown: number, max: number, setPreferred: (w: number) => void, dragging: RefObject<boolean>) {
  return useCallback(
    (e: KeyboardEvent) => {
      const next = keyTarget(e.key, shown, max);
      if (next === null) return;
      commitWidth(next, setPreferred, dragging);
      e.preventDefault();
    },
    [shown, max, setPreferred, dragging],
  );
}

function commitWidth(next: number, setPreferred: (w: number) => void, dragging: RefObject<boolean>) {
  const clamped = clampAnchoredWidth(next, window.innerWidth);
  document.body.classList.add("rlc-resizing");
  setPreferred(clamped);
  writeStoredAnchoredWidth(clamped);
  requestAnimationFrame(() => {
    if (!dragging.current) document.body.classList.remove("rlc-resizing");
  });
}

// The docked chat's width. Only the applied value is clamped, so a stored
// preference above the window's cap comes back when the window widens.
export function useAnchoredResize() {
  const handleRef = useRef<HTMLDivElement>(null);
  const [preferred, setPreferred] = useState<number | null>(readStoredAnchoredWidth);
  const vw = useViewportWidth();
  const narrow = vw <= ANCHORED_NARROW_PX;
  const max = anchoredMaxPx(vw);
  const applied = preferred == null ? null : clampAnchoredWidth(preferred, vw);
  useAnchoredWidthVar(applied, narrow);
  const measured = useMeasuredWidth(handleRef, preferred, vw);
  const shown = applied ?? measured;
  const startResize = useResizeDrag(shown, setPreferred, { min: ANCHORED_MIN_PX, max, storageKey: ANCHORED_WIDTH_KEY, growsLeft: true });
  const { dragging, onMouseDown } = useResizingClass(startResize);
  const onKeyDown = useKeyboardResize(shown, max, setPreferred, dragging);
  return { handleRef, narrow, shown, max, onMouseDown, onKeyDown };
}
