import { useEffect, useRef, useState } from "react";
import type { FlowLayout } from "../lib/mscFlowLayout";
import { easeInOut, tweenFlowLayout } from "../lib/mscFlowTween";

/** How long a month-to-month transition takes. Shorter than the
 *  autoplay's one-second step, so a playing chart settles before it moves
 *  again. */
export const FLOW_TWEEN_MS = 650;

/** The flow layout to draw right now: `target` once a transition settles,
 *  and in between, a frame interpolated from wherever the chart was —
 *  including mid-transition, so a quick second click bends the motion
 *  rather than restarting it. The first layout, and every layout under
 *  prefers-reduced-motion, is drawn as is. */
export function useTweenedFlow(target: FlowLayout, duration = FLOW_TWEEN_MS): FlowLayout {
  const [drawn, setDrawn] = useState(target);
  const drawnRef = useRef(target);
  drawnRef.current = drawn;

  useEffect(() => {
    const from = drawnRef.current;
    if (from === target) return;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || typeof requestAnimationFrame !== "function") {
      setDrawn(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / duration);
      setDrawn(k >= 1 ? target : tweenFlowLayout(from, target, easeInOut(k)));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return drawn;
}
