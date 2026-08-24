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
export const RIGHT_GUTTER = 160;
// Flow band height. Deliberately short: the venue table below carries the exact
// figures, so the chart's job is proportion at a glance — and the two have to be
// readable on one screen. Label separation (not this) sets the floor on height.
export const INNER_H = 150;
export const WIDTH = 860;
// Minimum label baseline separation: one line on the left, name + total on the right.
const LABEL_LINE = 11;
const SINK_LABEL_BLOCK = 26;

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

  const mag = (v: SankeyVenue) => Math.abs(v.profitToSky) + Math.abs(v.profitToGrove);
  const leftVals = venues.map(mag);
  const leftSum = leftVals.reduce((a, b) => a + b, 0);
  const skyVal = venues.reduce((n, v) => n + Math.abs(v.profitToSky), 0);
  const primeVal = venues.reduce((n, v) => n + Math.abs(v.profitToGrove), 0);
  if (leftSum <= 0) return { width, height: 0, nodes: [], links: [] };

  const px = INNER_H / leftSum;
  const hOf = (v: number) => Math.max(MIN_PX, v * px);
  const leftHeights = leftVals.map(hOf);
  const rightParts = [
    { id: "sky", label: "Sky", kind: "sky" as const, value: skyVal },
    { id: "prime", label: primeLabel, kind: "prime" as const, value: primeVal },
  ].filter((p) => p.value > 0);
  const rightHeights = rightParts.map((p) => hOf(p.value));
  const leftX = LEFT_GUTTER;
  const rightX = width - RIGHT_GUTTER - NODE_W;

  const leftNodes = stack(
    venues.map((v, i) => ({ id: v.id, label: v.label, kind: "venue" as const, h: leftHeights[i]! })),
    leftX,
    LABEL_LINE,
  );
  const rightNodes = stack(
    rightParts.map((p, i) => ({ id: p.id, label: p.label, kind: p.kind, h: rightHeights[i]! })),
    rightX,
    SINK_LABEL_BLOCK,
  );
  const nodes: SankeyNode[] = [...leftNodes, ...rightNodes];

  const colH = (hs: number[]) => hs.reduce((a, b) => a + b, 0) + PAD * Math.max(0, hs.length - 1);
  // A pushed-down label can outrun its column, so the box has to cover both.
  const lowestLabel = Math.max(...nodes.map((n) => n.labelY + SINK_LABEL_BLOCK / 2));
  const height = Math.max(colH(leftHeights), colH(rightHeights), lowestLabel) + 8;

  const leftCursor = new Map(nodes.map((n) => [n.id, n.y]));
  const rightCursor = new Map(leftCursor);
  const links: SankeyLink[] = [];
  const x0 = leftX + NODE_W;
  for (const v of venues) {
    for (const spec of [
      { to: "sky", signed: v.profitToSky },
      { to: "prime", signed: v.profitToGrove },
    ]) {
      const abs = Math.abs(spec.signed);
      if (abs < 1e-9 || !nodes.some((n) => n.id === spec.to)) continue;
      const t = hOf(abs);
      const y0 = leftCursor.get(v.id)!;
      const y1 = rightCursor.get(spec.to)!;
      leftCursor.set(v.id, y0 + t);
      rightCursor.set(spec.to, y1 + t);
      links.push({ from: v.id, to: spec.to, value: abs, signed: spec.signed, path: ribbon(x0, y0, t, rightX, y1, t) });
    }
  }
  return { width, height, nodes, links };
}

function stack(
  items: { id: string; label: string; kind: SankeyNode["kind"]; h: number }[],
  x: number,
  minLabelGap: number,
): SankeyNode[] {
  let y = 4;
  let prevLabel = -Infinity;
  return items.map((it) => {
    const labelY = Math.max(y + it.h / 2, prevLabel + minLabelGap);
    prevLabel = labelY;
    const n: SankeyNode = { id: it.id, label: it.label, x, y, width: NODE_W, height: it.h, kind: it.kind, labelY };
    y += it.h + PAD;
    return n;
  });
}

function ribbon(x0: number, y0: number, t0: number, x1: number, y1: number, t1: number): string {
  const cx = (x0 + x1) / 2;
  const y0b = y0 + t0;
  const y1b = y1 + t1;
  return `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1b} C${cx},${y1b} ${cx},${y0b} ${x0},${y0b} Z`;
}
