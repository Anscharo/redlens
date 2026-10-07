import { readStoredSize } from "../../hooks/useResizeDrag";
import { writeString } from "../../lib/safeStorage";

/** localStorage key for a dragged docked-chat width. The CSS variable of the
 *  same name is the live width (and the shell's matching right gutter). */
export const ANCHORED_WIDTH_KEY = "rlc-anchored-w";

/** Floor matches the undragged `clamp(340px, 30vw, 460px)` in chat.css. */
export const ANCHORED_MIN_PX = 340;

/** Dragged docked chat may grow to this fraction of the window width. */
export const ANCHORED_MAX_FRACTION = 0.55;

/** Below this the column is a full-screen takeover (chat.css) and is not dragged. */
export const ANCHORED_NARROW_PX = 520;

export const ANCHORED_KEYBOARD_STEP_PX = 24;

export function anchoredMaxPx(viewportWidth: number): number {
  return Math.max(ANCHORED_MIN_PX, Math.floor(viewportWidth * ANCHORED_MAX_FRACTION));
}

export function clampAnchoredWidth(px: number, viewportWidth: number): number {
  return Math.min(Math.max(Math.round(px), ANCHORED_MIN_PX), anchoredMaxPx(viewportWidth));
}

export function readStoredAnchoredWidth(): number | null {
  return readStoredSize(ANCHORED_WIDTH_KEY, ANCHORED_MIN_PX);
}

export function writeStoredAnchoredWidth(px: number): void {
  // A failed write leaves the in-memory width in effect for this session.
  writeString(ANCHORED_WIDTH_KEY, String(px));
}
