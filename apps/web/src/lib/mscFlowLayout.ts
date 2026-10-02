// Three-stage flow chart for the /radar MSC overview — the alternative to
// the orbital pies (mscOverviewLayout.ts), built from the same per-Prime
// month. LEFT: the line-item SOURCES (cost of funds, Sky Direct Exposure,
// supply-side kept, each demand-side series), one bar each, summed across
// Primes. MIDDLE: one bar per Prime (an "agent"), fed by its sources.
// RIGHT: Sky, one bar, split into what each Prime sent it, by type.
//
// SKY IS AT BOTH ENDS, and the source column is grouped by ORIGIN to say so.
// The Monthly Settlement Cycle settles two amounts running in opposite
// directions: what a Prime owes Sky for Supply Side Primitives
// (A.2.4.1.2.2.1.1.2), which leaves the Prime's bar on the right, and what
// SKY OWES THE PRIME for Demand Side Primitives and the Agent Rate
// (A.2.4.1.2.2.1.1.1), which is every demand-side source. Drawing those as
// plain sources said the Prime earned them: for Keel, Skybase and Osero
// that is the WHOLE bar, fed from the left with nothing going out. So the
// demand-side rows are BRACKETED (`sourceBracket`) — a `[` in Sky's own
// blue down the far left of the drawing, under a heading that names the
// party and carries the group's total. The bracket is what says "these are
// Sky's, not the Prime's", and its colour is what puts Sky at the left end
// of the chart as well as the right; it replaced a small Sky node with a
// ribbon into each demand bar, which said the same thing but read as a
// fourth stage of the flow. The earned group above it is separated by a
// blank band rather than a caption of its own (GROUP_HEADING).
//
// The source bars are NOT a column: each sits its own label-length from the
// left edge (`sourceBarX`), so the gap between a name and the bar it names
// is the same on every row. Lined up, a short name like "AR · agent rate"
// left a dead channel as wide as the longest name.
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
/** Column headers over the three node groups, and where they sit.
 *  Bigger than the group headings under SOURCE so they read as the
 *  columns, not as another caption. Size is on a 3000-wide canvas
 *  that renders at about half; 48 lands near 24px on screen. */
export const HEADERS = { source: "SOURCE", prime: "PRIME", sky: "SKY" } as const;
export const HEADER_SIZE = 48;
export const HEADER_Y = 56;
/** Group headings under SOURCE — smaller than the column labels. */
export const GROUP_HEADING_SIZE = 30;
/** Where each source's money ARISES. "earned" is the Prime's Allocation
 *  System; "sky" is the amount due from Sky under A.2.4.1.2.2.1.1.1, which
 *  is every demand-side series.
 *
 *  Note this is not "what the Prime keeps": Sky Direct Exposures are held
 *  by Sky and merely implemented through the Prime's Allocation System, and
 *  "All yield on Sky Direct Exposures is also due exclusively to Sky and is
 *  not retained by the Prime Agent" (A.2.2.10.1.1.1.1.5). SDE is grouped
 *  here because that is where it is earned, and the chart shows it leaving
 *  again on the right — which is why the heading names the Allocation
 *  System rather than saying the Prime earned it. */
export const SOURCE_ORIGIN: Record<string, "earned" | "sky"> = {
  cof: "earned",
  sde: "earned",
  kept: "earned",
  ...Object.fromEntries(DEMAND_SERIES.map((s) => [s.key, "sky" as const])),
};
/** The heading over the Sky-owed source group, flush left in the label
 *  gutter like every other left-hand label.
 *
 *  The earned group has NO heading: its three line items name themselves
 *  ("CoF · earned toward cost of funds", "supply-side kept"), and the
 *  caption that used to sit over them said the same thing twice. The
 *  Sky-owed group keeps its heading because it carries the group total and
 *  names the party the left-hand node belongs to. The blank band between
 *  the two groups (GROUP_GAP) is what still reads as "two groups", so it
 *  survives the heading's removal. */
export const GROUP_HEADING = {
  sky: "OWED BY SKY",
} as const;
/** A group heading sits this far above its first bar. */
const GROUP_HEADING_DY = 46;
/** Extra air between the two source groups, so they read as two. */
const GROUP_GAP = 96;
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
/** The amount follows the name on the same line, " | $12.71M", in mono at
 *  the same size; the gutter is sized for the widest name plus the widest
 *  compact amount. */
const AMOUNT_FONT = "44px 'Source Code Pro', 'Courier New', monospace";
const AMOUNT_CHAR_PX = 26.5;
const AMOUNT_ROOM = textWidth(" | $00.00M", AMOUNT_FONT, AMOUNT_CHAR_PX);
/** The canvas' own margin, left and right. */
const EDGE_PAD = 10;
/** The Sky bracket's column: a spine at BRACKET_X with both arms turning
 *  right, toward the rows it gathers. Reserved in EVERY month, demand side
 *  or not, so the labels never shift between months. */
export const BRACKET_X = EDGE_PAD;
export const BRACKET_ARM = 18;
const BRACKET_GAP = 14;
/** EVERY left-hand label starts here — the source lines, the OWED BY SKY
 *  heading and the SOURCE column header — flush left, just clear of the
 *  bracket column, rather than right-aligned into a gutter sized for the
 *  single longest string. */
export const LABEL_X = BRACKET_X + BRACKET_ARM + BRACKET_GAP;
/** The air either side of a label's own pipe — the space character in
 *  " | $12.47M", at that label's size. A label set closer to the bar it
 *  names than its own pipe is to its own words reads as touching it, so
 *  this is the FLOOR on every label-to-mark gap in the drawing. */
export const PIPE_SPACE = textWidth(" ", AMOUNT_FONT, AMOUNT_CHAR_PX);
/** At exactly the floor they still crowd, so every gap is half again. */
const gapFor = (space: number) => Math.round(space * 1.5);
/** Air between a source label and its bar — the SAME on every row, which is
 *  what turns the source column into a stagger. */
const LABEL_GAP = gapFor(PIPE_SPACE);
/** The reserved width of one source's whole label line: its name in Inter
 *  plus the amount in mono. The AMOUNT is reserved at its widest (" |
 *  $00.00M") rather than measured per month, so a bar sits at the same x
 *  whatever the month's figures are — the same reason the canvas is a fixed
 *  size. */
export function sourceLabelWidth(kind: string): number {
  return textWidth(SOURCE_LABEL[kind], SOURCE_FONT, SOURCE_CHAR_PX) + AMOUNT_ROOM;
}
/** Where one source's bar goes: its own label's end plus the shared gap. */
export function sourceBarX(kind: string): number {
  return LABEL_X + sourceLabelWidth(kind) + LABEL_GAP;
}
/** The rightmost source edge — the longest label's bar, and the left
 *  boundary everything downstream is measured from (MID_X, the ribbon
 *  span). Every other bar sits left of it. */
export const LEFT_X = Math.max(...Object.keys(SOURCE_LABEL).map(sourceBarX));
/** Sky's bar sits near the right edge, with its label — "To Sky | $15.86M",
 *  54px, RIGHT-aligned flush to the canvas edge and centred on the bar's own
 *  height, the mirror of the left column's treatment — running into a gutter
 *  sized for it. Its per-Prime shares are named by their hover pills. */
const SKY_FONT = "54px 'Inter', system-ui, sans-serif";
const SKY_MONO_FONT = "54px 'Source Code Pro', 'Courier New', monospace";
const SKY_MONO_CHAR_PX = 32.5;
export const SKY_LABEL_ROOM =
  textWidth("To Sky", SKY_FONT, 29.5) + textWidth(" | $00.00M", SKY_MONO_FONT, SKY_MONO_CHAR_PX);
/** The same floor, in the To Sky line's own (larger) font. */
export const SKY_PIPE_SPACE = textWidth(" ", SKY_MONO_FONT, SKY_MONO_CHAR_PX);
export const SKY_LABEL_GAP = gapFor(SKY_PIPE_SPACE);
/** Where every right-hand label ends: the SKY header and the To Sky line. */
export const SKY_LABEL_X = WIDTH - EDGE_PAD;
/** Sky's label sits BESIDE its bar, vertically centred on it, ending at the
 *  canvas' right margin — so the bar ends where "To Sky" begins and the
 *  gutter is exactly as wide as that line needs. */
const RIGHT_GUTTER = SKY_LABEL_ROOM + SKY_LABEL_GAP + EDGE_PAD;
export const RIGHT_X = WIDTH - RIGHT_GUTTER - NODE_W;
/** A Prime's label is ONE line under its bar, "Name | $x", drawn as THREE
 *  text runs rather than one string: the pipe centred on the column, the
 *  name end-anchored just left of it, the gross start-anchored just right.
 *  Anchoring does the alignment the browser is already doing anyway, so no
 *  name is ever measured — which is what went wrong when the whole string
 *  was offset by a measured width and every pipe landed a hair apart. */
export const AGENT_LINE_H = 48;
/** How far the name and the gross sit from the pipe's own centre. */
export const PIPE_HALF = 16;
/** A hairline ribbon is a few pixels of target on screen, which is not
 *  enough to hover. Any ribbon thinner than this gets an invisible stroke
 *  widening it to this much — the hit area grows, the drawing does not. */
export const HIT_MIN_T = 28;
/** The stroke that pads `t` out to HIT_MIN_T; a stroke straddles the path,
 *  so it adds half its width to each side. Zero once the ribbon is already
 *  wide enough to hit, which is when no padding should be drawn at all. */
export function hitStroke(t: number): number {
  return Math.max(0, HIT_MIN_T - t);
}
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
const AGENT_GAP = 118;
/** Below the headers and the first Prime's name block, with clear air
 *  between the PRIME header and the first name. */
const TOP = 100;
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
/** One line in the left gutter: name and amount, 44px. */
const SOURCE_LABEL_BLOCK = 56;
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

/** Set only mid-transition (mscFlowTween.ts): an item entering or leaving
 *  the chart fades as it grows or shrinks, so its label never sits on a
 *  neighbour's. Absent (fully opaque) on a settled layout. */
export interface Fading {
  alpha?: number;
}

export interface FlowSource extends Fading {
  kind: SliceKind;
  value: number;
  x: number;
  y: number;
  h: number;
  labelY: number;
  /** Where this source's money comes from (SOURCE_ORIGIN). */
  origin: "earned" | "sky";
  /** LEFT edge of its label — the same LABEL_X for every source, so the
   *  whole column is flush left. */
  labelX: number;
  /** Set on the first Sky-owed bar: the group heading's baseline. */
  headingY?: number;
}

/** The `[` down the far left that gathers the Sky-owed rows, and the total
 *  it stands for. Derived from the rows themselves (sourceBracket) rather
 *  than carried on the layout, so it follows the month-to-month tween
 *  without the tween knowing about it. */
export interface FlowBracket {
  x: number;
  /** Top and bottom of the rows it spans, labels included. */
  y0: number;
  y1: number;
  arm: number;
  path: string;
  value: number;
}

/** Half a source row: its bar's label reaches this far above and below the
 *  baseline, so a bracket sized to the BARS alone would clip a label. */
const ROW_HALF = 26;

/** Everything Sky owes this month — the sum of the Sky-owed rows, which the
 *  OWED BY SKY heading carries whether or not a bracket is drawn. */
export function owedBySky(sources: readonly FlowSource[]): number {
  return sources.reduce((n, s) => n + (s.origin === "sky" ? s.value : 0), 0);
}

/** The bracket for a month's Sky-owed rows, or null when there is nothing
 *  to gather: no demand side at all, or a single row — one row is not a
 *  group, and a `[` around it would be a stray glyph. The heading still
 *  says whose the row is in that case. */
export function sourceBracket(sources: readonly FlowSource[]): FlowBracket | null {
  const owed = sources.filter((s) => s.origin === "sky");
  if (owed.length < 2) return null;
  const y0 = Math.min(...owed.map((s) => Math.min(s.y, s.labelY - ROW_HALF)));
  const y1 = Math.max(...owed.map((s) => Math.max(s.y + s.h, s.labelY + ROW_HALF)));
  const arm = BRACKET_ARM;
  return {
    x: BRACKET_X,
    y0,
    y1,
    arm,
    path: `M${BRACKET_X + arm},${y0} H${BRACKET_X} V${y1} H${BRACKET_X + arm}`,
    value: owedBySky(sources),
  };
}

export interface FlowAgent extends Fading {
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

export interface FlowSkyShare extends Fading {
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
/** A Prime's label hangs UNDER its bar, so its band stops a label block
 *  short of the bottom and the last one stays on the canvas. */
const AGENT_BAND_H = BAND_H - AGENT_LINE_H;

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
  const agents = spread(acc.map((r) => ({ item: r, h: Math.max(inH(r), outH(r)) })), AGENT_BAND_H, AGENT_GAP, 0);
  const sourceBars = sourceKinds.map((k) => ({ item: k, h: acc.reduce((n, { a }) => n + t(a.inbound.find((x) => x.kind === k)?.value ?? 0), 0) }));
  // KINDS orders earned first, then the Sky-owed demand series, so the two
  // groups are already contiguous. The band gives up GROUP_GAP before the
  // spread and the Sky group takes it back, which separates the groups
  // without pushing the last bar off the bottom.
  const skyFirst = sourceKinds.findIndex((k) => SOURCE_ORIGIN[k] === "sky");
  const mixed = skyFirst > 0;
  const spreadBand = SOURCE_BAND_H - (mixed ? GROUP_GAP : 0);
  const sources = spread(sourceBars, spreadBand, SOURCE_GAP, SOURCE_LABEL_BLOCK).map((s, i) => {
    const shift = mixed && i >= skyFirst ? GROUP_GAP : 0;
    return { ...s, y: s.y + shift, labelY: s.labelY + shift };
  });
  const skyH = acc.reduce((n, { a }) => n + a.outbound.reduce((m, x) => m + t(x.value), 0), 0);
  // Centred on the PRIME band, not the whole canvas: Sky's own label hangs
  // under its bar like theirs, so it shares their shortened band and the
  // two columns stay level with each other.
  const skyY = TOP + Math.max(0, (AGENT_BAND_H - skyH) / 2);

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
      // Each ribbon leaves its OWN bar's right edge, so they fan from the
      // staggered source edges into the Prime column.
      const l = link(x.kind, x.value, sourceBarX(x.kind) + NODE_W, sy, MID_X, inY, "end");
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
    // The label hangs UNDER the bar, one line. The gross pill still rises
    // above it, where there is nothing else.
    const labelY = y + h + AGENT_LINE_H;
    return {
      prime: p.prime, x: MID_X, y, h, inbound, outbound, loss: a.loss,
      sky: a.sky, cof: a.cof, sde: a.sde, gross: a.gross,
      share: a.gross >= SETTLEMENT_NEAR_ZERO ? a.sky / a.gross : null,
      labelX: MID_X + AGENT_W / 2, labelY,
      grossPillX: MID_X + AGENT_W / 2,
      grossPillY: y - 84,
      grossAnchorY: y - 30,
    };
  });

  const bottom = Math.max(
    ...agents.map((g) => g.y + g.h + AGENT_LINE_H),
    ...sources.map((s) => Math.max(s.y + s.h, s.labelY + SOURCE_LABEL_BLOCK / 2)),
    skyY + skyH,
  );
  return {
    width: WIDTH,
    height: Math.max(HEIGHT, Math.round(bottom + BOTTOM_PAD)),
    sources: sources.map((s, i) => {
      const origin = SOURCE_ORIGIN[s.item];
      return {
        kind: s.item,
        value: sourceTotal(s.item),
        // Staggered: each bar sits its own label-length from the left edge.
        x: sourceBarX(s.item),
        y: s.y,
        h: s.h,
        labelY: s.labelY,
        origin,
        // Every left-hand label starts at the same x, flush left.
        labelX: LABEL_X,
        // Only the Sky-owed group is headed (GROUP_HEADING); the earned
        // group's blank band above it is separation enough.
        headingY: origin === "sky" && i === skyFirst ? s.y - GROUP_HEADING_DY : undefined,
      };
    }),
    agents: out,
    sky: { x: RIGHT_X, y: skyY, h: skyH, total: skyTotal, segments, shares },
  };
}
