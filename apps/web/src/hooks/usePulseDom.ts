import { useEffect } from "react";
import type { RefObject } from "react";

// Kept in sync with the --row-pulse-ms CSS variable; falls back to 700 ms.
const ROW_PULSE_MS = (() => {
  if (typeof window === "undefined") return 700;
  const v = getComputedStyle(document.documentElement).getPropertyValue("--row-pulse-ms").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 700;
})();

// Toggles `is-pulse` on the tree row matching `[data-node-id="${nodeId}"]` via
// direct DOM classList mutation rather than React state. Keeping nodeId out of
// the rowProps useMemo dependency array prevents react-window from re-rendering
// all visible rows twice per navigation — once when the class is added and once
// ROW_PULSE_MS later when it is removed.
//
// Always defers via requestAnimationFrame so the first attempt lands after
// scrollToRow has fired and the virtualized list has rendered the target row.
// Retries up to MAX_RETRIES times for rows that need an extra frame or two.
const MAX_RETRIES = 3;

export function usePulseDom(
  nodeId: string | null,
  containerRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!nodeId) return;
    const container = containerRef.current;

    let cancelled = false;
    let rafId: number;
    let timer: ReturnType<typeof setTimeout>;

    function tryPulse(attemptsLeft: number) {
      if (cancelled) return;
      const el = container?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`);
      if (el) {
        el.classList.add("is-pulse");
        timer = setTimeout(() => el.classList.remove("is-pulse"), ROW_PULSE_MS);
        return;
      }
      if (attemptsLeft > 0) {
        rafId = requestAnimationFrame(() => tryPulse(attemptsLeft - 1));
      }
    }

    rafId = requestAnimationFrame(() => tryPulse(MAX_RETRIES));

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timer);
      container
        ?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)
        ?.classList.remove("is-pulse");
    };
  }, [nodeId, containerRef]);
}
