import { useEffect } from "react";
import { hintStore } from "../lib/hintStore";
import { FOCUS_HINTS, HOVER_HINTS } from "../lib/hintText";

/**
 * Follows one marked element at a time and keeps its hint published.
 *
 * The marker is re-read on change, not just on arrival, because what a control
 * offers moves without the user doing anything the listeners would see: click a
 * collapsed chevron and it becomes a collapse-everything control while the
 * cursor sits still, and the search box swaps between its two hints when the
 * recents dropdown opens under a stationary caret. Neither fires a pointer or
 * focus event, so arrival-time reads alone would leave the footer promising the
 * wrong thing.
 */
function track(
  attr: string,
  hints: Readonly<Record<string, string>>,
  publish: (text: string | null) => void,
) {
  const selector = `[${attr}]`;
  let current: Element | null = null;
  const read = () => publish(current ? (hints[current.getAttribute(attr)!] ?? null) : null);
  const watch = new MutationObserver(read);
  const to = (el: Element | null) => {
    if (el === current) return;
    current = el;
    watch.disconnect();
    if (el) watch.observe(el, { attributes: true, attributeFilter: [attr] });
    read();
  };
  return {
    /** Follow the innermost marked ancestor of `target`, if any. */
    from: (target: EventTarget | null) =>
      to(target instanceof Element ? target.closest(selector) : null),
    /** Stop following, if we were. Cheap no-op when we weren't. */
    clear: () => to(null),
    /**
     * Force the tier empty regardless of what is being followed. `clear()`
     * early-returns when nothing is tracked, which is what keeps sweeping
     * unmarked space free — but it also means it can't guarantee the tier is
     * empty, which teardown and window-blur both need.
     */
    reset: () => {
      current = null;
      watch.disconnect();
      publish(null);
    },
  };
}

/**
 * Feeds the footer's hint line from the document, via delegation: an element
 * opts in with a single `data-mod-hint` (pointer) or `data-focus-hint`
 * (keyboard) attribute and this hook does the rest. One listener set for the
 * whole app rather than handlers on every row — the tree is virtualized and the
 * reader runs to ~1200 rows, and `closest()` resolves the innermost match for
 * free, so a chevron's hint beats the row it sits in with no extra plumbing.
 *
 * No React state, by the same reasoning as useModifierKeyAttrs: these events
 * fire continuously as the cursor moves, and the only consumer is one span in
 * the footer, which subscribes to hintStore directly.
 *
 * Mounted once at the App shell.
 */
export function useContextHints() {
  useEffect(() => {
    const hover = track("data-mod-hint", HOVER_HINTS, hintStore.setHover);
    const focus = track("data-focus-hint", FOCUS_HINTS, hintStore.setFocus);

    const onPointerOver = (e: PointerEvent) => {
      // Touch and pen fire pointerover on tap with no matching pointerout, so a
      // tap would strand a hint on screen until the next mouse move. These hints
      // describe modifier-clicks, which need a keyboard anyway.
      if (e.pointerType !== "mouse") return;
      hover.from(e.target);
    };
    // Leaving the window fires pointerout with no relatedTarget and no
    // follow-up pointerover, so without this the last hint would stick.
    const onPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) hover.clear();
    };
    const onFocusIn = (e: FocusEvent) => focus.from(e.target);
    // focusout fires before the next focusin, so clearing here can't clobber an
    // incoming hint — and it covers focus leaving the document entirely.
    const onFocusOut = () => focus.clear();
    // A hint held while the window loses focus never gets its matching pointer
    // or focus event back, so it would sit there over a page nobody is on.
    const clear = () => {
      hover.reset();
      focus.reset();
    };

    window.addEventListener("pointerover", onPointerOver);
    window.addEventListener("pointerout", onPointerOut);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("pointerover", onPointerOver);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);
}
