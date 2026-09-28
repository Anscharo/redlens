import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

// Left-edge splitter for the docked (full-height) chat. The undragged width
// stays the CSS clamp; a drag writes a pixel override onto --rlc-anchored-w,
// which the panel, the app shell's right padding, and the footer all read —
// so the column and the gutter stay the same width. The stored preference can
// sit above the current window's 55% cap; only the applied value is clamped,
// so widening the window restores it.
function useAnchoredResize() {
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [preferred, setPreferred] = useState<number | null>(readStoredAnchoredWidth);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [measured, setMeasured] = useState(ANCHORED_MIN_PX);

  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const narrow = vw <= ANCHORED_NARROW_PX;
  const max = anchoredMaxPx(vw);
  const applied = preferred == null ? null : clampAnchoredWidth(preferred, vw);

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

  // The drag has to start from the width on screen. Until the user has dragged,
  // that width is the CSS clamp, so measure it — writing the clamp into storage
  // would freeze a responsive default into a pixel.
  useLayoutEffect(() => {
    if (preferred != null) return;
    const w = handleRef.current?.parentElement?.offsetWidth ?? 0;
    if (w >= ANCHORED_MIN_PX) setMeasured((prev) => (prev === w ? prev : w));
  }, [preferred, vw]);

  const shown = applied ?? measured;
  const startResize = useResizeDrag(shown, setPreferred, {
    min: ANCHORED_MIN_PX,
    max,
    storageKey: ANCHORED_WIDTH_KEY,
    growsLeft: true,
  });

  useEffect(() => {
    return () => document.body.classList.remove("rlc-resizing");
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
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

  const commit = useCallback((next: number) => {
    const clamped = clampAnchoredWidth(next, window.innerWidth);
    document.body.classList.add("rlc-resizing");
    setPreferred(clamped);
    writeStoredAnchoredWidth(clamped);
    requestAnimationFrame(() => {
      if (!dragging.current) document.body.classList.remove("rlc-resizing");
    });
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowLeft") commit(shown + ANCHORED_KEYBOARD_STEP_PX);
      else if (e.key === "ArrowRight") commit(shown - ANCHORED_KEYBOARD_STEP_PX);
      else if (e.key === "Home") commit(ANCHORED_MIN_PX);
      else if (e.key === "End") commit(max);
      else return;
      e.preventDefault();
    },
    [shown, max, commit],
  );

  return { handleRef, narrow, shown, max, onMouseDown, onKeyDown };
}

export function AnchoredResizeHandle() {
  const { handleRef, narrow, shown, max, onMouseDown, onKeyDown } = useAnchoredResize();
  if (narrow) return null;
  return (
    <div
      ref={handleRef}
      className="rlc-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat"
      aria-valuemin={ANCHORED_MIN_PX}
      aria-valuemax={max}
      aria-valuenow={shown}
      tabIndex={0}
      title="Drag to resize"
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  );
}
