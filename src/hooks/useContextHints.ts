import { useEffect } from "react";
import { hintStore } from "../lib/hintStore";
import { FOCUS_HINTS, HOVER_HINTS, SELF_MANAGED } from "../lib/hintText";

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
    const hintOn = (target: EventTarget | null, attr: string): Element | null =>
      target instanceof Element ? target.closest(`[${attr}]`) : null;

    const textFor = (el: Element | null) =>
      el ? (HOVER_HINTS[el.getAttribute("data-mod-hint")!] ?? null) : null;

    // What a control offers can change while the cursor sits still on it: click
    // a collapsed chevron and it becomes a collapse-everything control, but the
    // mouse never moved, so no pointerover fires and the hint would still
    // promise the expand. Watching the one hovered element's marker costs
    // nothing and keeps the label honest.
    let hovered: Element | null = null;
    const markerWatch = new MutationObserver(() => hintStore.setHover(textFor(hovered)));
    const setHovered = (el: Element | null) => {
      if (el === hovered) return;
      hovered = el;
      markerWatch.disconnect();
      if (el) markerWatch.observe(el, { attributes: true, attributeFilter: ["data-mod-hint"] });
      hintStore.setHover(textFor(el));
    };

    const onPointerOver = (e: PointerEvent) => {
      // Touch and pen fire pointerover on tap with no matching pointerout, so a
      // tap would strand a hint on screen until the next mouse move. These hints
      // describe modifier-clicks, which need a keyboard anyway.
      if (e.pointerType !== "mouse") return;
      setHovered(hintOn(e.target, "data-mod-hint"));
    };
    // Leaving the window fires pointerout with no relatedTarget and no
    // follow-up pointerover, so without this the last hint would stick.
    const onPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) setHovered(null);
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = hintOn(e.target, "data-focus-hint");
      const key = el?.getAttribute("data-focus-hint");
      // The element publishes its own hint (see SELF_MANAGED) — don't stomp it.
      if (key === SELF_MANAGED) return;
      hintStore.setFocus(key ? (FOCUS_HINTS[key] ?? null) : null);
    };
    // focusout fires before the next focusin, so clearing here can't clobber an
    // incoming hint — and it covers focus leaving the document entirely.
    const onFocusOut = () => hintStore.setFocus(null);

    // A hint held while the window loses focus never gets its matching pointer
    // or focus event back, so it would sit there over a page nobody is on.
    const clear = () => {
      setHovered(null);
      hintStore.setFocus(null);
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
      markerWatch.disconnect();
    };
  }, []);
}
