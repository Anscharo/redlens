// A Prime's settlement month as a rainbow over one centre on the baseline:
// Venues at the left foot (angle π), the Prime at the apex (3π/2), Sky at
// the right foot (2π). Angles grow clockwise on screen.
//
// The OUTER lane runs clockwise, venues → Prime → Sky. Each venue is one
// contiguous group of stripes, inside out: kept, cost of funds, Sky Direct
// Exposure. Kept stops at the Prime; cost of funds and SDE pass through it
// without a break and arrive at Sky — together the amount due from the
// Prime to Sky (A.2.4.1.2.2.1.1.2). The INNER lane runs counterclockwise,
// Sky → Prime: the demand side (A.2.4.1.2.2.1.1.1). The two lanes are
// never netted, so each is drawn whole.
//
// One width scale for both lanes: the larger lane fills BAND. The radii are
// fixed, so a month change only re-widths stripes — the arch never moves.
import type { StreamModel } from "@/lib/settlementStreams";
import { arcArrowHead, arcPath } from "./arcGeometry";

export const BAND = 72;
export const INNER0 = 88;
const LANE_GAP = 18;
export const OUTER0 = INNER0 + BAND + LANE_GAP;
export const OUTER_END = OUTER0 + BAND;
export const PRIME_HALF = 7;
const HEAD_LEN = 12;
export const HEAD_FLARE = 3;
/** Thinnest stripe drawn, so a cent-sized figure is still visible. */
const MIN_W = 1.5;
/** Figures under half a dollar draw nothing. */
const NEAR = 0.5;
const LEFT = Math.PI;
const APEX = 1.5 * Math.PI;
const RIGHT = 2 * Math.PI;
/** Demand series outward from the inside: the cited ones first, GAR (no
 *  Atlas term) last. */
const INNER_ORDER = ["agentRate", "distributionRewards", "chroniclePoints", "gar"];
const PARTS = ["kept", "cof", "sde"] as const;

export const CX = OUTER_END + HEAD_FLARE + 12;
export const CY = OUTER_END + 48;
export const WIDTH = CX * 2;
export const HEIGHT = CY + 64;

export interface ArcBand {
  key: string;
  value: number;
  /** Centreline radius and stroke width. */
  r: number;
  w: number;
  /** Centreline, in the direction the money moves. */
  d: string;
  head: string | null;
  loss: boolean;
}

export interface Stripe extends ArcBand {
  venue: string;
  part: (typeof PARTS)[number];
}

export interface VenueLabel {
  venue: string;
  label: string;
  /** The group's centreline from the Venues foot to the Prime. */
  d: string;
  w: number;
  r: number;
}

export interface ArcLayout {
  stripes: Stripe[];
  demand: ArcBand[];
  venueLabels: VenueLabel[];
}

const width = (v: number, scale: number) => Math.max(MIN_W, Math.abs(v) * scale);
/** The angle at which a stripe of radius r meets the Prime bar's side. */
const primeEdge = (r: number, side: 1 | -1) => APEX + (side * PRIME_HALF) / r;

function stripe(venue: string, part: Stripe["part"], value: number, r: number, w: number): Stripe {
  const base = { key: `${venue}:${part}`, venue, part, value, r, w, loss: value < 0 };
  if (part === "kept") return { ...base, d: arcPath(CX, CY, r, LEFT, primeEdge(r, -1)), head: null };
  const end = RIGHT - HEAD_LEN / r;
  return { ...base, d: arcPath(CX, CY, r, LEFT, end), head: arcArrowHead(CX, CY, r, w, end, 1, HEAD_LEN, HEAD_FLARE) };
}

function layoutVenues(m: StreamModel, scale: number) {
  const stripes: Stripe[] = [];
  const venueLabels: VenueLabel[] = [];
  let edge = OUTER0;
  for (const v of m.venues) {
    const start = edge;
    for (const part of PARTS) {
      if (Math.abs(v[part]) < NEAR) continue;
      const w = width(v[part], scale);
      stripes.push(stripe(v.id, part, v[part], edge + w / 2, w));
      edge += w;
    }
    const r = (start + edge) / 2;
    if (edge > start) venueLabels.push({ venue: v.id, label: v.label, d: arcPath(CX, CY, r, LEFT, primeEdge(r, -1)), w: edge - start, r });
  }
  return { stripes, venueLabels };
}

function layoutDemand(m: StreamModel, scale: number): ArcBand[] {
  const parts = [...m.demand].sort((a, b) => INNER_ORDER.indexOf(a.key) - INNER_ORDER.indexOf(b.key));
  let edge = INNER0;
  return parts.map((p) => {
    const w = width(p.value, scale);
    const r = edge + w / 2;
    edge += w;
    const end = primeEdge(r, 1) + HEAD_LEN / r;
    return { key: p.key, value: p.value, r, w, loss: p.value < 0, d: arcPath(CX, CY, r, RIGHT, end), head: arcArrowHead(CX, CY, r, w, end, -1, HEAD_LEN, HEAD_FLARE) };
  });
}

export function layoutSettlementArc(m: StreamModel): ArcLayout {
  const outer = m.venues.reduce((n, v) => n + PARTS.reduce((k, p) => k + (Math.abs(v[p]) < NEAR ? 0 : Math.abs(v[p])), 0), 0);
  const inner = m.demand.reduce((n, d) => n + Math.abs(d.value), 0);
  const max = Math.max(outer, inner);
  const scale = max > 0 ? BAND / max : 0;
  return { ...layoutVenues(m, scale), demand: layoutDemand(m, scale) };
}
