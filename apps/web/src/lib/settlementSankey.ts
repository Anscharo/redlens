import type { SettlementVenue } from "./settlements";

export interface SankeyVenue {
  id: string;
  label: string;
  synthetic: boolean;
  profitToSky: number;
  profitToGrove: number;
}

export interface SankeyNode {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind: "venue" | "sky" | "prime";
  /**
   * Sink nodes only: whether this bar is what arrived or what went back out to
   * loss-making venues. The two are separate bars so each one's length is its
   * own gross figure — netting them inside one bar made a bar whose length
   * matched no number on the page.
   */
  flow?: "in" | "out";
  /**
   * Baseline for this node's label. Starts at the node's vertical centre and is
   * pushed down only as far as it takes to clear the label above it — a stack
   * of near-zero-height nodes would otherwise pile every label on one line.
   */
  labelY: number;
}

export interface SankeyLink {
  from: string;
  to: string;
  value: number;
  signed: number;
  path: string;
}

export interface SankeyLayout {
  width: number;
  height: number;
  nodes: SankeyNode[];
  links: SankeyLink[];
}

const NODE_W = 12;
// PAD is what keeps single-line venue labels off each other: consecutive label
// centres are at least PAD apart however thin the nodes get.
const PAD = 11;
const MIN_PX = 1.5;
// Gutters are separate because the two sides carry different text: venue names
// on the left, a name + a running total on the right.
export const LEFT_GUTTER = 190;
export const RIGHT_GUTTER = 118;
// Flow band height. Deliberately short: the venue table below carries the exact
// figures, so the chart's job is proportion at a glance — and the two have to be
// readable on one screen. Label separation (not this) sets the floor on height.
export const INNER_H = 150;
export const WIDTH = 860;
// Minimum label baseline separation: one line on the left, name + total on the right.
const LABEL_LINE = 11;
// Sink labels are two lines (name + figure); an out-bar's is two as well
// (what went out, then the net the pair settles to).
const SINK_LABEL_BLOCK = 24;
// A sink's out-bar hugs its in-bar, so the pair reads as one sink.
const PAIR_PAD = 4;

export function collapseVenues(
  venues: readonly Pick<SettlementVenue, "id" | "label" | "synthetic" | "profitToSky" | "profitToGrove">[],
  topN = 12,
  minAbs = 1,
): SankeyVenue[] {
  const kept = venues
    .map((v) => ({
      id: v.id,
      label: v.label || v.id,
      synthetic: v.synthetic,
      profitToSky: v.profitToSky,
      profitToGrove: v.profitToGrove,
      mag: Math.abs(v.profitToSky) + Math.abs(v.profitToGrove),
    }))
    .filter((v) => v.mag >= minAbs)
    .sort((a, b) => b.mag - a.mag);
  if (kept.length <= topN) return kept;
  const head = kept.slice(0, topN);
  const tail = kept.slice(topN);
  const other: SankeyVenue = {
    id: "_other",
    label: `Other venues (${tail.length})`,
    synthetic: false,
    profitToSky: tail.reduce((n, v) => n + v.profitToSky, 0),
    profitToGrove: tail.reduce((n, v) => n + v.profitToGrove, 0),
  };
  return [...head, other];
}

export function layoutVenueSankey(
  venues: readonly SankeyVenue[],
  primeLabel = "Prime",
  width = WIDTH,
): SankeyLayout {
  if (venues.length === 0) return { width, height: 0, nodes: [], links: [] };

  const leftSum = venues.reduce((t, v) => t + Math.abs(v.profitToSky) + Math.abs(v.profitToGrove), 0);
  if (leftSum <= 0) return { width, height: 0, nodes: [], links: [] };

  const px = INNER_H / leftSum;
  // Every ribbon is floored so the smallest venues stay visible at all. That
  // floor is why NOTHING here may be sized from a proportional total: a dozen
  // floored ribbons stack taller than the exact share they represent, and the
  // bar they dock into overflowed by up to 6px. Nodes are sized FROM the
  // ribbons instead — bar length is the sum of what docks to it, by
  // construction, on both sides of the chart.
  const hOf = (v: number) => Math.max(MIN_PX, v * px);

  // One bar per DIRECTION, not per sink: gains and losses are drawn separately
  // so every bar's length is its own gross figure. (Drawing Σ|x| in a single
  // bar made losses lengthen the bar they should shorten — 69% overlong for
  // Spark, and a fat positive bar for months whose net was negative.)
  const flows = venues.flatMap((v) =>
    [
      { from: v.id, sink: "sky", signed: v.profitToSky },
      { from: v.id, sink: "prime", signed: v.profitToGrove },
    ]
      .filter((f) => Math.abs(f.signed) >= 1e-9)
      .map((f) => ({
        ...f,
        to: f.signed < 0 ? `${f.sink}-out` : f.sink,
        value: Math.abs(f.signed),
        t: hOf(Math.abs(f.signed)),
      })),
  );
  if (flows.length === 0) return { width, height: 0, nodes: [], links: [] };

  const spanOf = (pick: (f: (typeof flows)[number]) => string, id: string) =>
    flows.reduce((t, f) => (pick(f) === id ? t + f.t : t), 0);

  const bars = [
    { id: "sky", label: "Sky", kind: "sky" as const },
    { id: "prime", label: primeLabel, kind: "prime" as const },
  ].flatMap((b) => {
    const inH = spanOf((f) => f.to, b.id);
    const outH = spanOf((f) => f.to, `${b.id}-out`);
    return [
      ...(inH > 0 ? [{ ...b, flow: "in" as const, h: inH, gap: PAD }] : []),
      ...(outH > 0
        ? [{ ...b, id: `${b.id}-out`, flow: "out" as const, h: outH, gap: inH > 0 ? PAIR_PAD : PAD }]
        : []),
    ];
  });

  const leftX = LEFT_GUTTER;
  const rightX = width - RIGHT_GUTTER - NODE_W;
  const leftNodes = stack(
    venues.map((v) => ({
      id: v.id,
      label: v.label,
      kind: "venue" as const,
      h: spanOf((f) => f.from, v.id),
    })),
    leftX,
    LABEL_LINE,
  );
  const rightNodes = stack(bars, rightX, SINK_LABEL_BLOCK);
  const nodes: SankeyNode[] = [...leftNodes, ...rightNodes];

  const colBottom = (ns: SankeyNode[]) => ns.reduce((t, n) => Math.max(t, n.y + n.height), 0);
  // A pushed-down label can outrun its column, so the box has to cover both.
  const lowestLabel = Math.max(...nodes.map((n) => n.labelY + SINK_LABEL_BLOCK / 2));
  const height = Math.max(colBottom(leftNodes), colBottom(rightNodes), lowestLabel) + 8;

  const leftCursor = new Map(leftNodes.map((n) => [n.id, n.y]));
  const rightCursor = new Map(rightNodes.map((n) => [n.id, n.y]));
  const x0 = leftX + NODE_W;
  const links: SankeyLink[] = flows.map((f) => {
    const y0 = leftCursor.get(f.from)!;
    const y1 = rightCursor.get(f.to)!;
    leftCursor.set(f.from, y0 + f.t);
    rightCursor.set(f.to, y1 + f.t);
    return {
      from: f.from,
      to: f.to,
      value: f.value,
      signed: f.signed,
      path: ribbon(x0, y0, f.t, rightX, y1, f.t),
    };
  });

  return { width, height, nodes, links };
}

function stack(
  items: { id: string; label: string; kind: SankeyNode["kind"]; h: number; flow?: "in" | "out"; gap?: number }[],
  x: number,
  minLabelGap: number,
): SankeyNode[] {
  let y = 4;
  let prevLabel = -Infinity;
  return items.map((it, i) => {
    if (i > 0) y += it.gap ?? PAD;
    const labelY = Math.max(y + it.h / 2, prevLabel + minLabelGap);
    prevLabel = labelY;
    const n: SankeyNode = {
      id: it.id,
      label: it.label,
      x,
      y,
      width: NODE_W,
      height: it.h,
      kind: it.kind,
      labelY,
      ...(it.flow ? { flow: it.flow } : {}),
    };
    y += it.h;
    return n;
  });
}

function ribbon(x0: number, y0: number, t0: number, x1: number, y1: number, t1: number): string {
  const cx = (x0 + x1) / 2;
  const y0b = y0 + t0;
  const y1b = y1 + t1;
  return `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1b} C${cx},${y1b} ${cx},${y0b} ${x0},${y0b} Z`;
}
