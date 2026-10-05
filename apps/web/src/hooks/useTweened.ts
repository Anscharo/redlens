import { useEffect, useRef, useState } from "react";

/** How long a month-to-month chart transition takes. Shorter than the
 *  autoplay's one-second step, so a playing chart settles before it moves
 *  again. */
export const TWEEN_MS = 650;

/** Cubic ease-in-out: slow off the mark, slow into place. */
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The value to draw right now: `target` once a transition settles, and in
 *  between, `lerp(from, target, k)` from wherever the chart was — including
 *  mid-transition, so a quick second click bends the motion rather than
 *  restarting it. The first value is drawn as is; so is every value under
 *  prefers-reduced-motion, or outside a real browser (no matchMedia — the
 *  test environment), where the charts simply snap.
 *
 *  `lerp` is a pure interpolation between two values of T at progress
 *  k ∈ (0, 1) — the chart's INPUT rows (tweenPrimeFlows, tweenVenues,
 *  tweenStreamModel), which the chart then lays out per frame
 *  so every frame is a geometrically valid chart. */
export function useTweened<T>(target: T, lerp: (from: T, to: T, k: number) => T, duration = TWEEN_MS): T {
  const [drawn, setDrawn] = useState(target);
  const drawnRef = useRef(target);
  drawnRef.current = drawn;

  useEffect(() => {
    const from = drawnRef.current;
    if (from === target) return;
    const animate =
      typeof matchMedia === "function" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      typeof requestAnimationFrame === "function";
    if (!animate) {
      setDrawn(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      setDrawn(k >= 1 ? target : lerp(from, target, easeInOut(k)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `lerp` is a module-level pure function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return drawn;
}
