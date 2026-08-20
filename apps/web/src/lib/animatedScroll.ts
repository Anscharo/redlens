// Fast fixed-duration scroll glide. Native behavior:"smooth" scales duration
// with distance (sluggish on long jumps — see CLAUDE.md); an instant pop gives
// no sense of direction. This always lands in GLIDE_MS regardless of distance.
// Set MAX_GLIDE_PX finite to teleport long jumps near the target first and
// only animate the final approach.

const HEADER_OFFSET = 64; // fallback when scroll-margin-top isn't set
const GLIDE_MS = 220;
const MAX_GLIDE_PX = Infinity;

// One in-flight glide per scroller: a second glide() call within GLIDE_MS
// (e.g. rapid nav clicks) must cancel the first rAF loop instead of letting
// both loops write scrollTop each frame and fight over the final position.
const activeGlide = new WeakMap<Element, symbol>();

export function glide(scroller: Element, target: number) {
  let start = scroller.scrollTop;
  const dist = target - start;
  if (Math.abs(dist) > MAX_GLIDE_PX) {
    start = target - Math.sign(dist) * MAX_GLIDE_PX;
    scroller.scrollTop = start;
  }
  const token = Symbol();
  activeGlide.set(scroller, token);
  const t0 = performance.now();
  const step = (now: number) => {
    if (activeGlide.get(scroller) !== token) return; // superseded by a later glide
    const t = Math.min(1, (now - t0) / GLIDE_MS);
    scroller.scrollTop = start + (target - start) * (1 - Math.pow(1 - t, 3));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** How much of a doc's body should be on screen after navigating to it — enough
 *  to show the doc has content and where it starts, not enough to be a jump. */
export const BODY_REVEAL_FRACTION = 0.2;

/**
 * Should we scroll to bring this node properly into view?
 *
 * Two conditions, both about the READER's usable band (below the sticky header,
 * down to the bottom of the scroller):
 *   1. the node's TITLE must be fully inside it — a title scrolled off the top
 *      is the case the old "any part of the row is visible" check missed, since
 *      a tall body left the row technically on screen with its heading gone;
 *   2. and at least BODY_REVEAL_FRACTION of the body must be showing.
 *
 * When the body is taller than the room beneath the title, that fraction is
 * unreachable, so we ask only for what could actually fit — otherwise a long
 * doc would scroll forever chasing a target it can never satisfy.
 *
 * Split out as pure geometry because jsdom has no layout: this is the part
 * worth testing, and it cannot be tested through the DOM.
 */
export function needsScroll(m: {
  viewTop: number;
  viewBottom: number;
  titleTop: number;
  titleBottom: number;
  bodyTop?: number;
  bodyBottom?: number;
}): boolean {
  if (m.titleTop < m.viewTop || m.titleBottom > m.viewBottom) return true;
  if (m.bodyTop === undefined || m.bodyBottom === undefined) return false;
  const bodyHeight = m.bodyBottom - m.bodyTop;
  if (bodyHeight <= 0) return false;
  const roomBelowTitle = m.viewBottom - m.viewTop - (m.titleBottom - m.titleTop);
  const want = Math.min(bodyHeight * BODY_REVEAL_FRACTION, Math.max(0, roomBelowTitle));
  const shown = Math.max(0, Math.min(m.bodyBottom, m.viewBottom) - Math.max(m.bodyTop, m.viewTop));
  // Half a pixel of slack: sub-pixel layout must not trigger a pointless glide.
  return shown + 0.5 < want;
}

/** Scrolls `el` to the top of its scroll container (honoring its
 *  scroll-margin-top) with a quick glide; no-op when already properly in view
 *  (see needsScroll). Aligning the node's top to the band is what maximises the
 *  body on screen, so the target is the same whichever condition triggered. */
export function scrollIfOutOfView(el: HTMLElement) {
  const { top } = el.getBoundingClientRect();
  const scroller = el.closest(".atlas-scroll");
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || HEADER_OFFSET;
  const scrollerRect = scroller?.getBoundingClientRect();
  const viewTop = (scrollerRect?.top ?? 0) + margin;
  const viewBottom = scrollerRect?.bottom ?? window.innerHeight;
  // The title bar, not the whole article — the article includes the body, and
  // its top being off screen is precisely what we are trying to detect.
  const titleRect = (el.querySelector("[data-row-bar]") ?? el).getBoundingClientRect();
  const bodyRect = el.querySelector(".atlas-node-body")?.getBoundingClientRect();
  if (
    !needsScroll({
      viewTop,
      viewBottom,
      titleTop: titleRect.top,
      titleBottom: titleRect.bottom,
      bodyTop: bodyRect?.top,
      bodyBottom: bodyRect?.bottom,
    })
  ) {
    return;
  }
  if (!scroller || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.scrollIntoView({ behavior: "instant", block: "start" });
    return;
  }
  const target = Math.max(
    0,
    Math.min(
      top - scroller.getBoundingClientRect().top + scroller.scrollTop - margin,
      scroller.scrollHeight - scroller.clientHeight,
    ),
  );
  glide(scroller, target);
}
