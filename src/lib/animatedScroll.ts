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

/** Scrolls `el` to the top of its scroll container (honoring its
 *  scroll-margin-top) with a quick glide; no-op when already in view. */
export function scrollIfOutOfView(el: HTMLElement) {
  const { top, bottom } = el.getBoundingClientRect();
  if (bottom > HEADER_OFFSET && top < window.innerHeight) return;
  const scroller = el.closest(".atlas-scroll");
  if (!scroller || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.scrollIntoView({ behavior: "instant", block: "start" });
    return;
  }
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || HEADER_OFFSET;
  const target = Math.max(
    0,
    Math.min(
      top - scroller.getBoundingClientRect().top + scroller.scrollTop - margin,
      scroller.scrollHeight - scroller.clientHeight,
    ),
  );
  glide(scroller, target);
}
