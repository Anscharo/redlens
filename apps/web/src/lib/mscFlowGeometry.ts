// Geometry helpers for the MSC flow chart (mscFlowLayout.ts): the ribbon
// between two node edges and the test for whether a figure fits on it.
import { textWidth } from "./textWidth";

/** The on-ribbon figure type: twice the orbital chart's in-slice figure
 *  (the flow canvas is wider than the orbit's and renders smaller, so its
 *  type is set larger to read the same on screen). */
export const FIGURE_FONT = "30px 'Source Code Pro', 'Courier New', monospace";
export const FIGURE_CHAR_PX = 18.2;
export const FIGURE_H = 32;
export const FIGURE_PAD = 6;

/** A band of thickness t from the right edge of one node (x0, y0..y0+t)
 *  to the left edge of another (x1, y1..y1+t). Both curves are the same
 *  cubic shifted by t, so the band is exactly t tall at every x. */
export function ribbonPath(x0: number, y0: number, x1: number, y1: number, t: number): string {
  const cx = (x0 + x1) / 2;
  return (
    `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1 + t} ` +
    `C${cx},${y1 + t} ${cx},${y0 + t} ${x0},${y0 + t} Z`
  );
}

/** Where a horizontal text box of `text` fits INSIDE the ribbon, or null.
 *  The band is t tall everywhere, so height is the easy half; the box's far
 *  corners must also stay inside the SLANTED band, so it is tried at the
 *  midpoint first and then closer to the `toward` end, where the cubic
 *  flattens out (the derivative there is a fraction of the midpoint's
 *  2·Δy/Δx). With P1 and P2 both at the middle x, the curve at parameter u
 *  is x = x0(1−u)³ + 3cx(1−u)u + x1u³ and y = y0 + Δy(3u² − 2u³). */
export function fitOnRibbon(
  text: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  toward: "start" | "end" = "end",
): { x: number; y: number } | null {
  const w = textWidth(text, FIGURE_FONT, FIGURE_CHAR_PX);
  const room = (t - FIGURE_H) / 2 - FIGURE_PAD;
  if (room < 0) return null;
  const dx = x1 - x0 || 1;
  const dy = y1 - y0;
  const cx = (x0 + x1) / 2;
  for (const u of toward === "end" ? [0.5, 0.85, 0.92] : [0.5, 0.15, 0.08]) {
    const x = x0 * (1 - u) ** 3 + 3 * cx * (1 - u) * u + x1 * u ** 3;
    const y = y0 + dy * (3 * u * u - 2 * u ** 3);
    const slope = Math.abs((6 * (1 - u) * u * dy) / (1.5 * dx * ((1 - u) ** 2 + u * u)));
    // The box must sit wholly on the ribbon, clear of the bar it docks to.
    if (Math.min(x - x0, x1 - x) < w / 2 + FIGURE_PAD) continue;
    if (slope * (w / 2) <= room) return { x, y: y + t / 2 };
  }
  return null;
}

export interface Stacked<T> {
  item: T;
  y: number;
  h: number;
  /** Baseline for a label beside the bar: the bar's middle, pushed down
   *  only as far as it takes to clear the label above. */
  labelY: number;
}

/** Bars stacked top-down from `top`, `gap` apart, with label baselines at
 *  least `labelBlock` apart so a run of hairline bars can't pile their
 *  labels on one line. */
export function stackBars<T>(items: { item: T; h: number }[], top: number, gap: number, labelBlock: number): Stacked<T>[] {
  let y = top;
  let prevLabel = -Infinity;
  return items.map(({ item, h }, i) => {
    if (i > 0) y += gap;
    const labelY = Math.max(y + h / 2, prevLabel + labelBlock);
    prevLabel = labelY;
    const out = { item, y, h, labelY };
    y += h;
    return out;
  });
}
