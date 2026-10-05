import { ANCHORED_MIN_PX } from "./anchoredWidth";
import { useAnchoredResize } from "./useAnchoredResize";

// Left-edge splitter for the docked (full-height) chat. A drag (or arrow
// keys) writes a pixel override onto --rlc-anchored-w, which the panel, the
// app shell's right padding, and the footer all read — so the column and the
// gutter stay the same width. See useAnchoredResize.ts.
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
