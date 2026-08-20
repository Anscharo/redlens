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
const PAD = 8;
const MIN_PX = 1.5;
const LABEL_GUTTER = 168;
const INNER_H = 380;

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
  width = 720,
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
  const colH = (hs: number[]) => hs.reduce((a, b) => a + b, 0) + PAD * Math.max(0, hs.length - 1);
  const height = Math.max(colH(leftHeights), colH(rightHeights)) + 8;
  const leftX = LABEL_GUTTER;
  const rightX = width - LABEL_GUTTER - NODE_W;

  const nodes: SankeyNode[] = [
    ...stack(venues.map((v, i) => ({ id: v.id, label: v.label, kind: "venue" as const, h: leftHeights[i]! })), leftX),
    ...stack(rightParts.map((p, i) => ({ id: p.id, label: p.label, kind: p.kind, h: rightHeights[i]! })), rightX),
  ];

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
): SankeyNode[] {
  let y = 4;
  return items.map((it) => {
    const n: SankeyNode = { id: it.id, label: it.label, x, y, width: NODE_W, height: it.h, kind: it.kind };
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
