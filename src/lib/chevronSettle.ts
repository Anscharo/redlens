// How long a chevron holds its new resting angle after a click before the
// hover-drift preview is allowed to start again. Long enough that the click's
// own outcome reads clearly even when the pointer never moves away, short
// enough that a pointer parked on the chevron isn't left waiting on the next
// preview.
// Paired with the `:not([data-settling])` hover rules in index.css — changing
// the behavior means changing both.
export const CHEVRON_SETTLE_MS = 1100;

/**
 * Park `btn` at its resting angle: flag it `[data-settling]`, which switches off
 * the slow hover-drift rule, then lift the flag after CHEVRON_SETTLE_MS so a
 * still-hovering pointer resumes drifting toward the *next* position.
 *
 * Deliberately an attribute rather than a class: React owns `className` on both
 * chevron buttons and rewrites it on the re-render that follows a toggle, which
 * would silently wipe a class set here. React never touches attributes it
 * doesn't render.
 *
 * Returns a cancel function — call it before settling again, and on unmount.
 */
export function settleChevron(btn: HTMLElement): () => void {
  btn.setAttribute("data-settling", "");
  const timer = setTimeout(() => btn.removeAttribute("data-settling"), CHEVRON_SETTLE_MS);
  return () => {
    clearTimeout(timer);
    btn.removeAttribute("data-settling");
  };
}
