import { useEffect } from "react";
import { createPortal } from "react-dom";

/** What a hovered segment hands the chart: the text to show and where the
 *  segment sits in the VIEWPORT (not in the chart), so the pill can be
 *  positioned from `document.body`. */
export interface PillHover {
  text: string;
  align: "start" | "center" | "end";
  left: number;
  right: number;
  top: number;
  width: number;
}

/** Read a hovered segment's viewport box into a PillHover. */
export function pillHoverFrom(el: Element, text: string, align: PillHover["align"]): PillHover {
  const r = el.getBoundingClientRect();
  return { text, align, left: r.left, right: r.right, top: r.top, width: r.width };
}

/**
 * The hover pill for one stack segment, portalled into `document.body`.
 *
 * CLAUDE.md says don't write hover logic in JS when CSS will do it — CSS
 * genuinely cannot do it here. The chart track lives inside a
 * `overflow-x: auto` wrapper, and `overflow-x: auto` computes `overflow-y`
 * to `auto` as well, so that wrapper is a CLIPPING + SCROLLING ancestor: a
 * pill on a tall segment near the top of the track is clipped by it and can
 * never paint over the legend above the chart. `z-index` cannot escape a
 * clipping ancestor — only leaving the subtree can. Hence the portal +
 * `position: fixed` off the segment's `getBoundingClientRect()`. Please
 * don't "simplify" this back into the segment.
 *
 * Cheap by construction: state moves on pointer enter/leave only (never on
 * mousemove), the pill is `pointer-events: none`, and it is dismissed on any
 * scroll or resize, since a fixed box cannot follow its anchor.
 */
export function MscTimeseriesPill({ hover, onDismiss }: { hover: PillHover | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!hover) return;
    const off = () => onDismiss();
    window.addEventListener("scroll", off, true);
    window.addEventListener("resize", off);
    return () => {
      window.removeEventListener("scroll", off, true);
      window.removeEventListener("resize", off);
    };
  }, [hover, onDismiss]);

  if (!hover || typeof document === "undefined") return null;
  // Edge columns hug the chart edge instead of overflowing it — the same
  // data-align contract the in-flow pill had.
  const x = hover.align === "start" ? hover.left : hover.align === "end" ? hover.right : hover.left + hover.width / 2;
  const shift = hover.align === "start" ? "0" : hover.align === "end" ? "-100%" : "-50%";
  return createPortal(
    <span
      className="msc-ts-pill mono"
      data-align={hover.align}
      aria-hidden="true"
      style={{ left: x, top: hover.top - 4, transform: `translate(${shift}, -100%)` }}
    >
      {hover.text}
    </span>,
    document.body,
  );
}
