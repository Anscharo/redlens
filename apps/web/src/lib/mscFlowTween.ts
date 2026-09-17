// Month-to-month transition for the MSC flow chart: a pure interpolation
// between two layouts (mscFlowLayout.ts) at progress k ∈ [0, 1]. Bars slide
// and stretch, ribbons re-thread and thicken, figures count. Every item is
// matched by identity — a source by its kind, a Prime by its name, a
// ribbon or Sky segment by Prime + kind — so a bar keeps its own shape
// across months. A Prime or line item present in only one month grows
// from, or shrinks to, zero thickness at its own place, so it merges in or
// peels away rather than popping.
//
// Column x positions and the canvas never change between months (the
// layout fixes them), so only y, height and thickness interpolate.
import { ribbonPath } from "./mscFlowGeometry";
import type { FlowAgent, FlowLayout, FlowLink, FlowSkyShare, FlowSkySource, FlowSource, RibbonGeom } from "./mscFlowLayout";

const mix = (a: number, b: number, k: number) => a + (b - a) * k;

/** Ease-in-out cubic: gentle at both ends, the read of a bar settling. */
export const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A collapsed twin: the same place, no height — where a vanishing item
 *  goes and an appearing one comes from. */
const flatSource = (s: FlowSource): FlowSource => ({ ...s, value: 0, h: 0 });
const flatShare = (s: FlowSkyShare): FlowSkyShare => ({ ...s, value: 0, h: 0 });
const flatGeom = (g: RibbonGeom): RibbonGeom => ({ ...g, t: 0 });
const flatLink = (l: FlowLink): FlowLink => ({ ...l, value: 0, geom: flatGeom(l.geom), path: ribbonPath(l.geom.x0, l.geom.y0, l.geom.x1, l.geom.y1, 0) });
const flatAgent = (a: FlowAgent): FlowAgent => ({
  ...a,
  h: 0,
  gross: 0,
  loss: 0,
  sky: 0,
  cof: 0,
  sde: 0,
  inbound: a.inbound.map(flatLink),
  outbound: a.outbound.map(flatLink),
});

/** Pair `to`'s items with their `from` twins (or a flat stand-in), then
 *  append `from`'s items that `to` lacks, paired with a flat stand-in of
 *  themselves. Output order is `to`'s, so the settled frame is `to` itself.
 *  `alpha` is the pair's opacity at progress k: an entering item fades in,
 *  a leaving one fades out, one present both months stays opaque — so a
 *  label never sits on a neighbour's while its bar is still flat. */
function pair<T>(from: T[], to: T[], key: (x: T) => string, flat: (x: T) => T, k: number): { a: T; b: T; alpha?: number }[] {
  const byKey = new Map(from.map((x) => [key(x), x]));
  const seen = new Set<string>();
  const out: { a: T; b: T; alpha?: number }[] = to.map((b) => {
    seen.add(key(b));
    const a = byKey.get(key(b));
    return a ? { a, b } : { a: flat(b), b, alpha: k };
  });
  for (const a of from) if (!seen.has(key(a))) out.push({ a, b: flat(a), alpha: 1 - k });
  return out;
}

function tweenLink(a: FlowLink, b: FlowLink, k: number): FlowLink {
  const geom: RibbonGeom = { x0: b.geom.x0, x1: b.geom.x1, y0: mix(a.geom.y0, b.geom.y0, k), y1: mix(a.geom.y1, b.geom.y1, k), t: mix(a.geom.t, b.geom.t, k) };
  return {
    ...b,
    value: mix(a.value, b.value, k),
    geom,
    path: ribbonPath(geom.x0, geom.y0, geom.x1, geom.y1, geom.t),
    midY: mix(a.midY, b.midY, k),
    pillY: mix(a.pillY, b.pillY, k),
    // The on-ribbon figure waits for the ribbon to settle (the caller
    // draws `to` itself at the end), rather than floating over a band
    // still finding its thickness.
    figureX: null,
    figureY: null,
  };
}

function tweenAgent(a: FlowAgent, b: FlowAgent, k: number): FlowAgent {
  return {
    ...b,
    y: mix(a.y, b.y, k),
    h: mix(a.h, b.h, k),
    gross: mix(a.gross, b.gross, k),
    loss: mix(a.loss, b.loss, k),
    sky: mix(a.sky, b.sky, k),
    cof: mix(a.cof, b.cof, k),
    sde: mix(a.sde, b.sde, k),
    labelY: mix(a.labelY, b.labelY, k),
    grossPillY: mix(a.grossPillY, b.grossPillY, k),
    grossAnchorY: mix(a.grossAnchorY, b.grossAnchorY, k),
    inbound: pair(a.inbound, b.inbound, (l) => l.kind, flatLink, k).map(({ a: la, b: lb }) => tweenLink(la, lb, k)),
    outbound: pair(a.outbound, b.outbound, (l) => l.kind, flatLink, k).map(({ a: la, b: lb }) => tweenLink(la, lb, k)),
  };
}

/** Sky's left-hand node, present only in months with a demand side: it
 *  fades in or out when one month has it and the other does not. Its
 *  ribbons are paired by source kind, like every other pair here. */
function tweenSkySource(a: FlowSkySource | null, b: FlowSkySource | null, k: number): FlowSkySource | null {
  if (!a && !b) return null;
  if (!a) return { ...b!, alpha: k };
  if (!b) return { ...a, alpha: 1 - k };
  const flat = (l: FlowSkySource["links"][number]) => ({ ...l, value: 0, geom: { ...l.geom, t: 0 } });
  return {
    ...b,
    y: mix(a.y, b.y, k),
    h: mix(a.h, b.h, k),
    value: mix(a.value, b.value, k),
    labelY: mix(a.labelY, b.labelY, k),
    links: pair(a.links, b.links, (l) => l.kind, flat, k).map(({ a: la, b: lb }) => {
      const geom: RibbonGeom = {
        x0: lb.geom.x0,
        x1: lb.geom.x1,
        y0: mix(la.geom.y0, lb.geom.y0, k),
        y1: mix(la.geom.y1, lb.geom.y1, k),
        t: mix(la.geom.t, lb.geom.t, k),
      };
      return { ...lb, value: mix(la.value, lb.value, k), geom, path: ribbonPath(geom.x0, geom.y0, geom.x1, geom.y1, geom.t) };
    }),
  };
}

/** The frame between two layouts at progress k (0 = from, 1 = to). At k = 1
 *  the result is `to` with its vanished items collapsed to nothing — the
 *  caller swaps in `to` itself once the transition ends. */
export function tweenFlowLayout(from: FlowLayout, to: FlowLayout, k: number): FlowLayout {
  if (k <= 0) return from;
  if (k >= 1) return to;
  const segKey = (s: { prime: string; kind: string }) => `${s.prime}::${s.kind}`;
  return {
    width: to.width,
    height: to.height,
    sources: pair(from.sources, to.sources, (s) => s.kind, flatSource, k).map(({ a, b, alpha }) => ({
      ...b,
      alpha,
      value: mix(a.value, b.value, k),
      y: mix(a.y, b.y, k),
      h: mix(a.h, b.h, k),
      labelY: mix(a.labelY, b.labelY, k),
    })),
    skySource: tweenSkySource(from.skySource, to.skySource, k),
    agents: pair(from.agents, to.agents, (a) => a.prime, flatAgent, k).map(({ a, b, alpha }) => ({ ...tweenAgent(a, b, k), alpha })),
    sky: {
      x: to.sky.x,
      y: mix(from.sky.y, to.sky.y, k),
      h: mix(from.sky.h, to.sky.h, k),
      total: mix(from.sky.total, to.sky.total, k),
      segments: pair(from.sky.segments, to.sky.segments, segKey, (s) => ({ ...s, h: 0 }), k).map(({ a, b }) => ({
        ...b,
        y: mix(a.y, b.y, k),
        h: mix(a.h, b.h, k),
      })),
      shares: pair(from.sky.shares, to.sky.shares, (s) => s.prime, flatShare, k).map(({ a, b, alpha }) => ({
        ...b,
        alpha,
        value: mix(a.value, b.value, k),
        y: mix(a.y, b.y, k),
        h: mix(a.h, b.h, k),
        pillY: mix(a.pillY, b.pillY, k),
      })),
    },
  };
}
