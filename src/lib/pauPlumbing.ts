// The static plumbing of a PAU, as the diagram at the top of a Prime's PAUs page
// draws it: who holds which part, and which part answers to which. Every edge
// is an access rule the contracts' own source states (the modifier named in
// `rule`), so the picture holds for any deployment of either generation. Pure.

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
  /** Label position; `end` right-aligns it there. */
  lx: number;
  ly: number;
  align?: "middle" | "end";
  /** Checked in both directions (arrowheads at both ends). */
  both?: boolean;
  /** Holds only for some deployments. */
  optional?: boolean;
}

export const PLUMBING_VIEW = { w: 960, h: 476, nodeH: 74 } as const;

/** The three contracts that are the PAU itself, framed together. */
export const PLUMBING_FRAME = { x: 270, y: 138, w: 460, h: 290, label: "PAU · one set per chain" } as const;

export const PLUMBING_NODES: PlumbingNode[] = [
  { id: "admin", name: "Admin", nick: "owner", lines: ["Prime's governance contract,", "run by executive spells."], x: 415, y: 16, w: 170 },
  { id: "relayer", name: "Relayer", nick: "operator", lines: ["Everyday key. Asks for", "moves; holds no funds."], x: 20, y: 176, w: 160 },
  { id: "controller", name: "Controller", nick: "control panel", lines: ["The fixed menu of moves", "a relayer can ask for."], x: 290, y: 176, w: 160 },
  { id: "almProxy", name: "ALM proxy", nick: "vault", lines: ["Holds the funds. Acts", "only for its controller."], x: 550, y: 176, w: 160 },
  { id: "venues", name: "Allocations", nick: "destinations", lines: ["Lending markets, vaults,", "swaps and bridges."], x: 790, y: 176, w: 150 },
  { id: "freezer", name: "Freezer", nick: "emergency stop", lines: ["Cuts off a relayer. Sets", "nothing, moves nothing."], x: 20, y: 330, w: 160 },
  { id: "rateLimits", name: "Rate limits", nick: "meter", lines: ["How much each move can", "carry; refills over time."], x: 290, y: 330, w: 160 },
];

export const PLUMBING_EDGES: PlumbingEdge[] = [
  {
    from: "admin", to: "controller", kind: "rule", label: "grants every role · sets limits and parameters",
    rule: "DEFAULT_ADMIN_ROLE on the controller, the ALM proxy and the rate limits", d: "M500 90 V132", lx: 510, ly: 116,
  },
  { from: "relayer", to: "controller", kind: "flow", label: "asks for a move", rule: "onlyRole(RELAYER) on every controller action", d: "M180 213 H284", lx: 225, ly: 204, align: "middle" },
  {
    from: "controller", to: "rateLimits", kind: "flow", label: "checks, then draws down",
    rule: "onlyRole(CONTROLLER) on triggerRateLimitDecrease / Increase", d: "M370 256 V324", lx: 380, ly: 294, both: true,
  },
  { from: "controller", to: "almProxy", kind: "flow", label: "executes through", rule: "onlyRole(CONTROLLER) on doCall", d: "M450 213 H544", lx: 497, ly: 204, align: "middle" },
  { from: "almProxy", to: "venues", kind: "flow", label: "calls", rule: "the proxy is the account the venue sees", d: "M710 213 H784", lx: 760, ly: 204, align: "middle" },
  { from: "freezer", to: "relayer", kind: "stop", label: "removes a relayer", rule: "onlyRole(FREEZER) on removeRelayer", d: "M100 330 V256", lx: 110, ly: 294 },
  {
    from: "freezer", to: "almProxy", kind: "stop", label: "on a freezable proxy: removes its controller", optional: true,
    rule: "onlyRole(FREEZER) on ALMProxyFreezable.removeController", d: "M100 404 V446 H630 V256", lx: 112, ly: 462,
  },
];

/** How a Diamond PAU differs, for the caption: the same plumbing with the controller split up. */
export const DIAMOND_NOTE =
  "A Diamond PAU has the same plumbing. Its controller hands each move to a facet, one per kind of move; its relayers call through an AdministeredAgent, whose revokers are its freezers; its roles are kept in AccessControls.";

export const PLUMBING_KEY: Record<PlumbingKind, string> = {
  flow: "a move on its way to the funds",
  rule: "sets the rules",
  stop: "can cut off",
};
