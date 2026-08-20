import { useRef, useCallback } from "react";
import type { RefObject } from "react";

// Sets `data-expanding` on the referenced element for `durationMs`, then removes it.
// Done as a plain DOM attribute mutation rather than React state so that user-initiated
// depth-6 expansion clicks don't invalidate docList's useMemo dependency array —
// which would rebuild ~1200 CollapsibleNode elements on every click.
// The CSS `@starting-style` rule is scoped to `[data-expanding]`, so newly inserted
// nodes only animate when this attribute is present (user opened them interactively),
// not when navigation auto-expands them.
export function useExpandingAttr(ref: RefObject<HTMLElement | null>, durationMs = 250) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    el.setAttribute("data-expanding", "true");
    timerRef.current = setTimeout(() => {
      el.removeAttribute("data-expanding");
      timerRef.current = null;
    }, durationMs);
  }, [ref, durationMs]);
}
