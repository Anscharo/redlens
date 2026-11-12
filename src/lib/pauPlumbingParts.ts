// The vocabulary of the PAU plumbing diagrams (pauPlumbing.ts): a part, a
// relationship between two parts, and the parts both generations share. Pure.

/** What an edge carries: a move on its way to the funds, the power to configure, or the power to cut off. */
export type PlumbingKind = "flow" | "rule" | "stop";

export interface PlumbingNode {
  id: string;
  name: string;
  /** Its part in a factory. */
  nick: string;
  /** What it does, pre-wrapped to the box. */
  lines: [string, string];
  x: number;
  y: number;
  w: number;
  /** Taller than PLUMBING_NODE_H, for a part several rows reach. */
  h?: number;
  /** A part the other generation does not have. */
  own?: boolean;
}

export interface PlumbingEdge {
  from: string;
  to: string;
  kind: PlumbingKind;
  label: string;
  /** The access rule in the contract source that makes the edge true. */
  rule: string;
  /** SVG path, tail to head. */
  d: string;
  /** Label position; `align` anchors it there. */
  lx: number;
  ly: number;
  align?: "middle" | "end";
  /** Checked in both directions (arrowheads at both ends). */
  both?: boolean;
  /** Holds only for some deployments. */
  optional?: boolean;
}

/** A row's name in the left gutter, for a diagram read as lanes. */
export interface PlumbingLane {
  y: number;
  title: string;
  sub: string;
}

export interface Plumbing {
  /** Names its SVG's title and arrowheads, unique on the page. */
  id: string;
  w: number;
  h: number;
  frameLabel: string;
  /** What an outlined (`own`) part is, for the key. */
  ownNote?: string;
  /** What the diagram covers, above it where a page shows more than one. */
  title?: string;
  lanes?: PlumbingLane[];
  /** The contracts that are the PAU itself, framed together. */
  frame: { x: number; y: number; w: number; h: number };
  nodes: PlumbingNode[];
  edges: PlumbingEdge[];
  /** The diagram in one sentence, for a reader who cannot see it. */
  summary: string;
}

export const PLUMBING_H = 476;
export const PLUMBING_NODE_H = 74;

type At = Pick<PlumbingNode, "x" | "y"> & Partial<Pick<PlumbingNode, "w">>;
const part = (id: string, name: string, nick: string, lines: [string, string]) => (at: At): PlumbingNode => ({ id, name, nick, lines, w: 160, ...at });

/** The parts both generations have, placed by each diagram. */
export const SHARED = {
  admin: part("admin", "Admin", "owner", ["Prime's governance contract,", "run by executive spells."]),
  relayer: part("relayer", "Relayer", "operator", ["Everyday key. Asks for", "moves; holds no funds."]),
  almProxy: part("almProxy", "ALM proxy", "vault", ["Holds the funds. Acts", "only for its controller."]),
  venues: part("venues", "Allocations", "destinations", ["Lending markets, vaults,", "swaps and bridges."]),
  freezer: part("freezer", "Freezer", "emergency stop", ["Cuts off a relayer. Sets", "nothing, moves nothing."]),
  rateLimits: part("rateLimits", "Rate limits", "meter", ["How much each move can", "carry; refills over time."]),
};
