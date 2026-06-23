// Fit the uppercase type-pill label into the (often narrow) selected-node
// gutter: measure the text and scale the font down toward a readable floor.
// When even the floor overflows the caller lets the pill wrap (white-space:
// normal), so this never produces clipped text — only smaller or wrapped.

export const PILL_MAX_PX = 10;
export const PILL_MIN_PX = 7;

let ctx: CanvasRenderingContext2D | null | undefined;

function measure(text: string, fontPx: number): number {
  if (ctx === undefined) {
    ctx = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!ctx) return text.length * fontPx * 0.62; // no canvas (jsdom/node) — rough guess
  ctx.font = `600 ${fontPx}px "Source Code Pro", "Courier New", monospace`;
  // letter-spacing (0.06em) isn't reflected by measureText — add it back per gap.
  return ctx.measureText(text).width + 0.06 * fontPx * Math.max(0, text.length - 1);
}

/**
 * Largest font size in [PILL_MIN_PX, PILL_MAX_PX] at which `text` fits on one
 * line within `maxWidth` px. Returns PILL_MIN_PX when even that overflows.
 *
 * This picks the font only — the box width is then measured from the real
 * rendered line boxes (NodeMeta), which is exact regardless of font metrics.
 */
export function fitPillFontSize(text: string, maxWidth: number): number {
  if (maxWidth <= 0) return PILL_MAX_PX;
  const upper = text.toUpperCase();
  const atMax = measure(upper, PILL_MAX_PX);
  if (atMax <= maxWidth) return PILL_MAX_PX;
  // width scales ~linearly with font size, so this lands right at the fit point.
  const scaled = (PILL_MAX_PX * maxWidth) / atMax;
  return Math.max(PILL_MIN_PX, Math.min(PILL_MAX_PX, Math.round(scaled * 10) / 10));
}
