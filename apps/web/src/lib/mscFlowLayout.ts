// Three-stage flow chart for the /radar MSC overview — the alternative to
// the orbital pies (mscOverviewLayout.ts), built from the same per-Prime
// month. LEFT: the line-item SOURCES (cost of funds, Sky Direct Exposure,
// supply-side kept, each demand-side series), one bar each, summed across
// Primes. MIDDLE: one bar per Prime (an "agent"), fed by its sources.
// RIGHT: Sky, one bar, split into what each Prime sent it, by type.
//
// A Prime's bar is as tall as the larger of its two sides: what feeds it
// (what the book EARNED toward cost of funds, Sky Direct Exposure,
// supply-side kept, the demand-side series) and what leaves it for Sky
// (cost of funds in full + SDE). The two sides need not match, and nothing
// is drawn to make them: what a Prime kept simply stops at its bar. A
// supply-side LOSS is the case where more leaves than arrives — the book
// earned less than its cost of funds, still owes all of it, and pays the
// rest itself — so the cost-of-funds source feeds the Prime only cof − loss
// while the full cost of funds goes on to Sky, and the unfed stretch of the
// bar's left edge IS the loss (also a line on the gross pill; the orbital
// chart's hole).
//
// Pure math, no DOM — the view maps over prebuilt path strings.

import { DEMAND_SERIES, SETTLEMENT_NEAR_ZERO, formatUsd } from "@/lib/settlements";
import type { PrimeFlowTotals } from "@/lib/settlementsOverview";
import { SLICE_CODE, type SliceKind } from "./mscOverviewLayout";
import { fitOnRibbon, ribbonPath, stackBars } from "./mscFlowGeometry";
import { textWidth } from "./textWidth";

/** A WIDE canvas — 3:1, wider than the card beside the timeseries — so
 *  `meet` scaling is height-bound and the drawing runs the card's full
 *  width. Type sizes are set for that scale (roughly half on screen). */
export const WIDTH = 3000;
/** Source and Sky bars: ~6px on screen at the card's usual render scale. */
export const NODE_W = 25;
/** The Prime column's bars are the chart's "islands" — wider than the
 *  source and Sky bars so they read as the middle stage. */
export const AGENT_W = 40;
/** Column headers over the three node groups, and where they sit. */
export const HEADERS = { source: "SOURCE", prime: "PRIME", sky: "SKY" } as const;
export const HEADER_Y = 40;
/** Source names in the left gutter — the key's wording: a code only where
 *  it adds one ("CoF · cost of funds", plain "supply-side kept"). Lives
 *  here because the gutter is sized from the widest of them. */
export const SOURCE_LABEL: Record<string, string> = {
  cof: "CoF · earned toward cost of funds",
  sde: "SDE · Sky Direct Exposure",
  kept: "supply-side kept",
  ...Object.fromEntries(DEMAND_SERIES.map((s) => [s.key, `${SLICE_CODE[s.key]} · ${s.label.toLowerCase()}`])),
};
const SOURCE_FONT = "44px 'Inter', system-ui, sans-serif";
const SOURCE_CHAR_PX = 24;
/** Column x: sources (labels in the gutter to their left, which is as wide
 *  as the widest label needs), Primes, Sky (its per-Prime name + figure in
 *  the gutter to its right). */
export const LEFT_X = Math.max(...Object.values(SOURCE_LABEL).map((l) => textWidth(l, SOURCE_FONT, SOURCE_CHAR_PX))) + 24;
/** Sky's bar sits near the right edge; its per-Prime shares are named by
 *  their hover pills, not in a gutter. */
const RIGHT_GUTTER = 40;
export const RIGHT_X = WIDTH - RIGHT_GUTTER - NODE_W;
/** The Prime column sits 3/5 of the way across the ribbon span: the left
 *  half carries up to seven sources fanning into every Prime, the right
 *  only the two To-Sky ribbons, so the busier side gets the room. */
export const MID_X = LEFT_X + NODE_W + 0.6 * (RIGHT_X - LEFT_X - NODE_W - AGENT_W);
/** The tallest column's bars sum to this. Kept short on purpose: the bars
 *  are spread over the canvas height (space-between, like a flex column),
 *  so the gaps between them are what is left of the band. */
const INNER_H = 340;
/** Gap floors: a column whose bars plus these overflow the band stacks at
 *  these and stretches the canvas instead. */
const SOURCE_GAP = 70;
/** Room above each Prime's bar for its name (42px) and gross figure (28px). */
const AGENT_GAP = 120;
/** Below the headers and the first Prime's name block, with clear air
 *  between the PRIME header and the first name. */
const TOP = 160;
const BOTTOM_PAD = 16;
/** Fixed canvas height, so the viewBox — and with it the scale, the column
 *  x positions and the headers — never changes from month to month. Tall
 *  enough for the roster the workbooks have published (a seventh Prime
 *  would stretch it, once). */
export const HEIGHT = 1200;
/** Ribbon floor. The canvas renders at about half size, so this is ~2px on
 *  screen: a Prime's smallest line item (Skybase's accessibility rewards,
 *  ~1% of the month) stays a visible hairline rather than vanishing. */
const MIN_T = 4;
/** Two lines in the left gutter: name (44px) over amount (38px). */
const SOURCE_LABEL_BLOCK = 100;
/** Pill center above the mark it names — clears a 3×-scale pill (90 tall). */
const PILL_LIFT = 65;
/** A share's pill sits left of Sky's bar, inside the canvas. */
const SHARE_PILL_INSET = 220;

/** A ribbon's endpoints: the right edge of one bar (x0, y0..y0+t) to the
 *  left edge of another (x1, y1..y1+t). Kept beside the path so the
 *  month-to-month tween (mscFlowTween.ts) can regenerate it. */
export interface RibbonGeom {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t: number;
}

export interface FlowLink {
  prime: string;
  kind: SliceKind;
  value: number;
  path: string;
  geom: RibbonGeom;
  /** Ribbon midpoint — where the pill's leader touches it. */
  midX: number;
  midY: number;
  pillX: number;
  pillY: number;
  /** Permanent figure on the ribbon, when it fits. */
  figureX: number | null;
  figureY: number | null;
}

export interface FlowSource {
  kind: SliceKind;
  value: number;
  x: number;
  y: number;
  h: number;
  labelY: number;
}

export interface FlowAgent {
  prime: string;
  x: number;
  y: number;
  h: number;
  inbound: FlowLink[];
  /** To Sky: cost of funds and Sky Direct Exposure. */
  outbound: FlowLink[];
  /** Every negative line item summed — a figure, not a mark (0 when none). */
  loss: number;
  sky: number;
  cof: number;
  sde: number;
  gross: number;
  share: number | null;
  labelX: number;
  labelY: number;
  grossPillX: number;
  grossPillY: number;
  grossAnchorY: number;
}

export interface FlowSkyShare {
  prime: string;
  value: number;
  y: number;
  h: number;
  pillX: number;
  pillY: number;
}

export interface FlowLayout {
  width: number;
  height: number;
  sources: FlowSource[];
  agents: FlowAgent[];
  sky: { x: number; y: number; h: number; total: number; segments: { prime: string; kind: SliceKind; y: number; h: number }[]; shares: FlowSkyShare[] };
}

/** The vertical band every column's bars are laid out in. A source label
 *  is centered on its bar, so that column's band stops half a label block
 *  short of the bottom edge and the last label stays on the canvas. */
const BAND_H = HEIGHT - BOTTOM_PAD - TOP;
const SOURCE_BAND_H = BAND_H - SOURCE_LABEL_BLOCK / 2;

/** Space-between over the band: equal gaps, never below the floor. */
function spread<T>(bars: { item: T; h: number }[], bandH: number, minGap: number, labelBlock: number) {
  const sumH = bars.reduce((n, b) => n + b.h, 0);
  if (bars.length <= 1) return stackBars(bars, TOP + Math.max(0, (bandH - sumH) / 2), minGap, labelBlock);
  const gap = Math.max(minGap, (bandH - sumH) / (bars.length - 1));
  return stackBars(bars, TOP, gap, labelBlock);
}

const KINDS: SliceKind[] = ["cof", "sde", "kept", ...DEMAND_SERIES.map((s) => s.key)];

/** One Prime's signed line items, and what the chart draws of them. */
function account(p: PrimeFlowTotals) {
  const items: Record<string, number> = { cof: p.cof, sde: p.sde, kept: p.kept };
  for (const s of DEMAND_SERIES) items[s.key] = p.demandParts[s.key] ?? 0;
  const near = (v: number) => Math.abs(v) >= SETTLEMENT_NEAR_ZERO;
  const loss = KINDS.reduce((n, k) => n + (items[k] < 0 && near(items[k]) ? -items[k] : 0), 0);
  // Sources: every positive item — except cost of funds, which the book
  // may not have earned in full (the loss comes off it); it is still owed
  // in full, so the outbound side carries all of it.
  const inbound = KINDS.map((k) => {
    const v = k === "cof" ? Math.max(0, items.cof - loss) : Math.max(0, items[k]);
    return { kind: k, value: near(v) ? v : 0 };
  }).filter((x) => x.value > 0);
  const outbound = (["cof", "sde"] as SliceKind[])
    .map((k) => ({ kind: k, value: near(items[k]) && items[k] > 0 ? items[k] : 0 }))
    .filter((x) => x.value > 0);
  // The bar accounts for every positive item, cost of funds in full.
  const total = KINDS.reduce((n, k) => n + Math.max(0, near(items[k]) ? items[k] : 0), 0);
  const gross = total - loss;
  return { inbound, outbound, loss, total, gross, sky: p.sky, cof: p.cof, sde: p.sde };
}

export function layoutMscFlow(primes: readonly PrimeFlowTotals[]): FlowLayout {
  const acc = primes.map((p) => ({ p, a: account(p) })).filter(({ a }) => a.total > 0 || a.loss > 0);
  const empty: FlowLayout = { width: WIDTH, height: HEIGHT, sources: [], agents: [], sky: { x: RIGHT_X, y: TOP, h: 0, total: 0, segments: [], shares: [] } };
  if (acc.length === 0) return empty;

  const sourceTotal = (k: SliceKind) => acc.reduce((n, { a }) => n + (a.inbound.find((x) => x.kind === k)?.value ?? 0), 0);
  const sourceKinds = KINDS.filter((k) => sourceTotal(k) > 0);
  const skyTotal = acc.reduce((n, { a }) => n + a.outbound.reduce((m, x) => m + x.value, 0), 0);
  const colMax = Math.max(1, sourceKinds.reduce((n, k) => n + sourceTotal(k), 0), acc.reduce((n, { a }) => n + a.total, 0), skyTotal);
  const t = (v: number) => (v > 0 ? Math.max(MIN_T, (v / colMax) * INNER_H) : 0);

  // Bars are sized FROM their ribbons (the floor makes a stack of hairlines
  // taller than its exact share), so every bar is the sum of what docks on
  // its taller side: the inbound ribbons, or the To-Sky ribbons.
  const inH = ({ a }: (typeof acc)[number]) => a.inbound.reduce((n, x) => n + t(x.value), 0);
  const outH = ({ a }: (typeof acc)[number]) => a.outbound.reduce((n, x) => n + t(x.value), 0);
  // Every column uses the whole band between the headers and the bottom
  // edge: the source and Prime columns spread their bars over it with equal
  // gaps (first bar at the top, last at the bottom — a lone bar centers),
  // and the Sky bar centers on it.
  const agents = spread(acc.map((r) => ({ item: r, h: Math.max(inH(r), outH(r)) })), BAND_H, AGENT_GAP, 0);
  const sourceBars = sourceKinds.map((k) => ({ item: k, h: acc.reduce((n, { a }) => n + t(a.inbound.find((x) => x.kind === k)?.value ?? 0), 0) }));
  const sources = spread(sourceBars, SOURCE_BAND_H, SOURCE_GAP, SOURCE_LABEL_BLOCK);
  const skyH = acc.reduce((n, { a }) => n + a.outbound.reduce((m, x) => m + t(x.value), 0), 0);
  const skyY = TOP + Math.max(0, (BAND_H - skyH) / 2);

  // Ribbons: from each source down its bar in Prime order; into each Prime
  // down its bar in source order; into Sky, Prime-major, cost of funds first.
  const srcCursor = new Map(sources.map((s) => [s.item, s.y]));
  let skyCursor = skyY;
  const segments: FlowLayout["sky"]["segments"] = [];
  const shares: FlowSkyShare[] = [];
  const out: FlowAgent[] = agents.map(({ item: { p, a }, y, h }) => {
    let inY = y;
    // Figures gather around the Prime's bar: an inbound ribbon's near its
    // end, an outbound one's near its start.
    const link = (kind: SliceKind, value: number, x0: number, y0: number, x1: number, y1: number, toward: "start" | "end"): FlowLink => {
      const th = t(value);
      const text = `${SLICE_CODE[kind]} ${formatUsd(value, true)}`;
      const fit = fitOnRibbon(text, x0, y0, x1, y1, th, toward);
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2 + th / 2;
      return { prime: p.prime, kind, value, path: ribbonPath(x0, y0, x1, y1, th), geom: { x0, y0, x1, y1, t: th }, midX, midY, pillX: midX, pillY: midY - PILL_LIFT - th / 2, figureX: fit?.x ?? null, figureY: fit?.y ?? null };
    };
    const inbound = a.inbound.map((x) => {
      const sy = srcCursor.get(x.kind)!;
      const l = link(x.kind, x.value, LEFT_X + NODE_W, sy, MID_X, inY, "end");
      srcCursor.set(x.kind, sy + t(x.value));
      inY += t(x.value);
      return l;
    });
    let outY = y;
    const shareY = skyCursor;
    const outbound = a.outbound.map((x) => {
      const l = link(x.kind, x.value, MID_X + AGENT_W, outY, RIGHT_X, skyCursor, "start");
      segments.push({ prime: p.prime, kind: x.kind, y: skyCursor, h: t(x.value) });
      skyCursor += t(x.value);
      outY += t(x.value);
      return l;
    });
    const skyValue = a.outbound.reduce((n, x) => n + x.value, 0);
    if (skyValue > 0) {
      const sh = skyCursor - shareY;
      shares.push({ prime: p.prime, value: skyValue, y: shareY, h: sh, pillX: RIGHT_X - SHARE_PILL_INSET, pillY: shareY + sh / 2 - PILL_LIFT });
    }
    // Name (36px) above the bar, gross (24px) on the line under it, just
    // clear of the bar's top; the gross pill hangs above both.
    const labelY = y - 50;
    return {
      prime: p.prime, x: MID_X, y, h, inbound, outbound, loss: a.loss,
      sky: a.sky, cof: a.cof, sde: a.sde, gross: a.gross,
      share: a.gross >= SETTLEMENT_NEAR_ZERO ? a.sky / a.gross : null,
      labelX: MID_X + AGENT_W / 2, labelY,
      grossPillX: MID_X + AGENT_W / 2, grossPillY: labelY - 56, grossAnchorY: labelY - 28,
    };
  });

  const bottom = Math.max(
    ...agents.map((g) => g.y + g.h),
    ...sources.map((s) => Math.max(s.y + s.h, s.labelY + SOURCE_LABEL_BLOCK / 2)),
    skyY + skyH,
  );
  return {
    width: WIDTH,
    height: Math.max(HEIGHT, Math.round(bottom + BOTTOM_PAD)),
    sources: sources.map((s) => ({ kind: s.item, value: sourceTotal(s.item), x: LEFT_X, y: s.y, h: s.h, labelY: s.labelY })),
    agents: out,
    sky: { x: RIGHT_X, y: skyY, h: skyH, total: skyTotal, segments, shares },
  };
}
