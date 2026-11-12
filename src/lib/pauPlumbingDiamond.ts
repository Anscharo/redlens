// A Diamond PAU's plumbing: the controller is a switchboard that runs each move
// in a shared facet, relayers reach it through an AdministeredAgent, and its
// roles sit in AccessControls. Each `rule` is the check in the diamond-pau
// Controller, AdministeredAgent and facet sources, and in ALMProxy and RateLimits.
import { PLUMBING_H, SHARED, type Plumbing } from "./pauPlumbingParts.ts";

export const DIAMOND_PLUMBING: Plumbing = {
  id: "pau-plumbing-diamond",
  h: PLUMBING_H,
  frameLabel: "PAU · one set per chain",
  w: 1160,
  frame: { x: 220, y: 138, w: 730, h: 290 },
  summary:
    "A relayer calls through the AdministeredAgent, which forwards to the controller; the controller checks the caller's role in AccessControls, runs the move in a facet, checks the rate limits and executes through the ALM proxy, which holds the funds. The admin configures them; a freezer can remove a relayer from the AdministeredAgent.",
  nodes: [
    SHARED.admin({ x: 500, y: 16, w: 170 }),
    SHARED.relayer({ x: 20, y: 176 }),
    { id: "agent", name: "AdministeredAgent", nick: "front desk", lines: ["Lists the relayers and", "forwards their calls."], x: 240, y: 176, w: 160, own: true },
    { id: "controller", name: "Controller", nick: "switchboard", lines: ["Routes each move to", "the facet that runs it."], x: 480, y: 176, w: 160 },
    SHARED.almProxy({ x: 770, y: 176 }),
    SHARED.venues({ x: 990, y: 176, w: 150 }),
    SHARED.freezer({ x: 20, y: 330 }),
    { id: "accessControls", name: "AccessControls", nick: "roster", lines: ["Who holds which role", "on the controller."], x: 240, y: 330, w: 160, own: true },
    { id: "facets", name: "Facets", nick: "tools", lines: ["Shared code, one per kind", "of move, from a Beacon."], x: 480, y: 330, w: 160, own: true },
    SHARED.rateLimits({ x: 770, y: 330 }),
  ],
  edges: [
    {
      from: "admin", to: "controller", kind: "rule", label: "grants every role · sets limits · wires in facets",
      rule: "DEFAULT_ADMIN_ROLE in AccessControls (updateIntegrations is onlyAdmin), on the ALM proxy and on the rate limits", d: "M585 90 V132", lx: 595, ly: 116,
    },
    { from: "relayer", to: "agent", kind: "flow", label: "calls through", rule: "onlyActor on AdministeredAgent.call", d: "M180 205 H234", lx: 200, ly: 168, align: "end" },
    { from: "agent", to: "controller", kind: "flow", label: "forwards", rule: "AdministeredAgent.call calls its target as itself", d: "M400 205 H474", lx: 437, ly: 196, align: "middle" },
    {
      from: "controller", to: "accessControls", kind: "flow", label: "checks the caller's role",
      rule: "a facet's onlyRole asks AccessControls.hasRole(role, msg.sender)", d: "M480 235 H440 V367 H406", lx: 432, ly: 300, align: "end",
    },
    { from: "controller", to: "facets", kind: "flow", label: "runs the move in", rule: "the Controller's fallback delegatecalls the facet wired to the selector", d: "M560 256 V324", lx: 570, ly: 294 },
    { from: "controller", to: "almProxy", kind: "flow", label: "executes through", rule: "onlyRole(CONTROLLER) on doCall", d: "M640 205 H764", lx: 702, ly: 196, align: "middle" },
    {
      from: "controller", to: "rateLimits", kind: "flow", label: "checks, then draws down",
      rule: "onlyRole(CONTROLLER) on triggerRateLimitDecrease / Increase", d: "M646 235 H720 V367 H764", lx: 728, ly: 300, both: true,
    },
    { from: "almProxy", to: "venues", kind: "flow", label: "calls", rule: "the proxy is the account the venue sees", d: "M930 213 H984", lx: 968, ly: 204, align: "middle" },
    {
      from: "freezer", to: "agent", kind: "stop", label: "removes a relayer",
      rule: "AdministeredAgent.removeActor, open to its revokers and admins", d: "M180 350 H206 V235 H234", lx: 198, ly: 300, align: "end",
    },
  ],
};
