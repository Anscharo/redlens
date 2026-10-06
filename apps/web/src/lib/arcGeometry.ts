// Circular-arc paths for the settlement arc. Angles are radians in SVG
// screen space (y down), so an INCREASING angle runs clockwise on screen.
// Pure math, no DOM.

const f = (n: number) => (Math.round(n * 100) / 100).toString();

export function polar(cx: number, cy: number, r: number, a: number): string {
  return `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
}

/** The centreline of an arc from a0 to a1, drawn in the direction of travel
 *  (a1 > a0 is clockwise), so a stroke-dashoffset counting down moves the
 *  dashes the way the arc runs. Sweeps under a full turn. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = a1 > a0 ? 1 : 0;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${polar(cx, cy, r, a0)} A${f(r)},${f(r)} 0 ${large} ${sweep} ${polar(cx, cy, r, a1)}`;
}

/** A triangle continuing a band of width `w` past angle `a`: its base spans
 *  the band plus `flare` each side, its tip `len` further along the arc in
 *  direction `dir` (1 clockwise, −1 counterclockwise). */
export function arcArrowHead(cx: number, cy: number, r: number, w: number, a: number, dir: 1 | -1, len: number, flare = 0): string {
  const half = w / 2 + flare;
  const tip = a + (dir * len) / r;
  return `M${polar(cx, cy, r - half, a)} L${polar(cx, cy, r, tip)} L${polar(cx, cy, r + half, a)} Z`;
}
