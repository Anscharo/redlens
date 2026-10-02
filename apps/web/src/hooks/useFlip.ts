import { useLayoutEffect, useRef, type RefObject } from "react";

/** FLIP for a list whose children carry `data-flip-key`: whenever their
 *  ORDER changes, each child that moved slides from where it was to where
 *  it is now (a translateY that eases back to zero), so a reorder reads as
 *  rows physically swapping rather than repainting. Positions are taken
 *  from offsetTop, so an in-flight slide never feeds back into the next
 *  measurement. Nothing moves under prefers-reduced-motion. */
export function useFlip(list: RefObject<HTMLElement | null>, duration = 350): void {
  const prevTop = useRef(new Map<string, number>());
  const prevOrder = useRef("");
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const children = [...el.children].filter(
      (c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute("data-flip-key"),
    );
    const order = children.map((c) => c.getAttribute("data-flip-key")).join(" ");
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const moved = order !== prevOrder.current;
    const next = new Map<string, number>();
    for (const child of children) {
      const key = child.getAttribute("data-flip-key") ?? "";
      next.set(key, child.offsetTop);
      const was = prevTop.current.get(key);
      if (!moved || reduced || was == null) continue;
      const dy = was - child.offsetTop;
      if (Math.abs(dy) < 0.5) continue;
      child.style.transition = "none";
      child.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        child.style.transition = `transform ${duration}ms ease`;
        child.style.transform = "";
      });
    }
    prevTop.current = next;
    prevOrder.current = order;
  });
}
