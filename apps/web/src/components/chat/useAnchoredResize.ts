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

// Writes the applied width onto --rlc-anchored-w, which the panel, the app
// shell's right padding, and the footer all read. Removed when there is no
// override or the window is too narrow for one.
function useAnchoredWidthVar(applied: number | null, narrow: boolean) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (applied == null || narrow) {
      root.style.removeProperty("--rlc-anchored-w");
      return;
    }
    root.style.setProperty("--rlc-anchored-w", `${applied}px`);
    // removeProperty returns the previous value. An implicit return makes the
    // cleanup `() => string`, which is not a valid effect destructor.
    return () => {
      root.style.removeProperty("--rlc-anchored-w");
    };
  }, [applied, narrow]);
}

// The drag has to start from the width on screen. Until the user has dragged,
// that width is the CSS clamp, so it is measured — writing the clamp into
// storage would freeze a responsive default into a pixel.
function useMeasuredWidth(handleRef: RefObject<HTMLDivElement | null>, preferred: number | null, vw: number): number {
  const [measured, setMeasured] = useState(ANCHORED_MIN_PX);
  useLayoutEffect(() => {
    if (preferred != null) return;
    const w = handleRef.current?.parentElement?.offsetWidth ?? 0;
    if (w >= ANCHORED_MIN_PX) setMeasured((prev) => (prev === w ? prev : w));
  }, [handleRef, preferred, vw]);
  return measured;
}

// body.rlc-resizing holds for the length of a mouse drag (and a frame after a
// keyboard step), suppressing transitions while the width moves.
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

// Arrow keys step the width (Left widens: the handle is on the left edge);
// Home and End jump to the bounds. null for any other key.
function keyTarget(key: string, shown: number, max: number): number | null {
  if (key === "ArrowLeft") return shown + ANCHORED_KEYBOARD_STEP_PX;
  if (key === "ArrowRight") return shown - ANCHORED_KEYBOARD_STEP_PX;
  if (key === "Home") return ANCHORED_MIN_PX;
  return key === "End" ? max : null;
}

// Each keyboard step is clamped and persisted.
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

// The docked chat's width. The undragged width stays the CSS clamp; a drag or
// keyboard step stores a pixel preference. The stored preference can sit
// above the current window's 55% cap; only the applied value is clamped, so
// widening the window restores it.
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
