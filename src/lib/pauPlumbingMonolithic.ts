// A monolithic ALM Controller's plumbing: one controller contract holds the
// whole menu of moves and its own RELAYER and FREEZER roles. Each `rule` is the
// modifier in MainnetController / ForeignController, ALMProxy and RateLimits.
import { PLUMBING_H, SHARED, type Plumbing } from "./pauPlumbingParts.ts";

export const MONOLITHIC_PLUMBING: Plumbing = {
  id: "pau-plumbing-monolithic",
  h: PLUMBING_H,
  frameLabel: "PAU · one set per chain",
  w: 960,
  frame: { x: 270, y: 138, w: 460, h: 290 },
  summary:
    "A relayer asks the controller for a move; the controller checks the rate limits and executes through the ALM proxy, which holds the funds. The admin configures all three; a freezer can remove a relayer.",
  nodes: [
    SHARED.admin({ x: 415, y: 16, w: 170 }),
    SHARED.relayer({ x: 20, y: 176 }),
    { id: "controller", name: "Controller", nick: "control panel", lines: ["The fixed menu of moves", "a relayer can ask for."], x: 290, y: 176, w: 160 },
    SHARED.almProxy({ x: 550, y: 176 }),
    SHARED.venues({ x: 790, y: 176, w: 150 }),
    SHARED.freezer({ x: 20, y: 330 }),
    SHARED.rateLimits({ x: 290, y: 330 }),
  ],
  edges: [
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
    { from: "freezer", to: "relayer", kind: "stop", label: "removes a relayer", rule: "onlyRole(FREEZER) on the controller's removeRelayer", d: "M100 330 V256", lx: 110, ly: 294 },
    {
      from: "freezer", to: "almProxy", kind: "stop", label: "on a freezable proxy: removes its controller", optional: true,
      rule: "onlyRole(FREEZER) on ALMProxyFreezable.removeController", d: "M100 404 V446 H630 V256", lx: 112, ly: 462,
    },
  ],
};
