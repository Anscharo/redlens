import { useRef, useCallback } from "react";

interface ResizeDragOptions {
  min: number;
  max: number;
  storageKey?: string;
  /** Which dimension the drag resizes. "x" (default) reads clientX and shows a
   *  col-resize cursor; "y" reads clientY and shows row-resize. */
  axis?: "x" | "y";
  /** Invert the drag direction: on the x axis, dragging LEFT grows the panel
   *  (right-anchored panels); on the y axis, dragging UP grows it
   *  (bottom-anchored panels). Not derivable from the axis — the tree sidebar
   *  grows right, the annotations panel grows left, the split pane grows up. */
  growsLeft?: boolean;
}

export function useResizeDrag(
  width: number,
  setWidth: (w: number) => void,
  { min, max, storageKey, axis = "x", growsLeft = false }: ResizeDragOptions,
): React.MouseEventHandler {
  // Ref keeps current width readable inside the stable handler without adding
  // width to useCallback's dep array, which would recreate the handler on every
  // pixel of a drag and allocate mid-gesture closures.
  const widthRef = useRef(width);
  widthRef.current = width;

  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = axis === "y" ? e.clientY : e.clientX;
      const startWidth = widthRef.current;
      let latest = startWidth;
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = axis === "y" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        const pos = axis === "y" ? ev.clientY : ev.clientX;
        const delta = growsLeft ? start - pos : pos - start;
        latest = Math.max(min, Math.min(max, startWidth + delta));
        setWidth(latest);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        // Only a real drag persists. `startWidth` can be a display cap rather
        // than the caller's stored preference (see useSplitHeight's childless
        // shrink-to-fit) — writing it back on a no-op press-release would
        // silently overwrite that preference with the cap.
        if (storageKey && latest !== startWidth) {
          try {
            localStorage.setItem(storageKey, String(latest));
          } catch {}
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [min, max, storageKey, axis, growsLeft, setWidth],
  );
}
