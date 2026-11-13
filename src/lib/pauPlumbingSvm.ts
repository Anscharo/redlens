// The Solana ALM Controller's plumbing: one program whose state is accounts.
// A Permission account per holder carries its flags, and each Reserve (a
// token) and Integration (a venue) carries its own limit. Each `rule` is a
// field or flag of the program's account layouts (src/server/pau/svm-layout.ts).
import { PLUMBING_H, SHARED, type Plumbing } from "./pauPlumbingParts.ts";

export const SVM_PLUMBING: Plumbing = {
  id: "pau-plumbing-svm",
  w: 960,
  h: PLUMBING_H,
  frame: { x: 270, y: 138, w: 460, h: 290 },
  frameLabel: "One program · its accounts",
  ownNote: "an account of the Solana program",
  summary:
    "A relayer asks the ALM program for a move; the program checks the relayer's Permission account, checks and draws down the limits on the Reserve and the Integration, and moves the Reserve's tokens out. The admin sets the permissions, limits and integrations; a freezer can freeze the controller.",
  nodes: [
    { ...SHARED.admin({ x: 415, y: 16, w: 170 }), lines: ["The Prime's SubProxy, acting", "over LayerZero governance."] },
    SHARED.relayer({ x: 20, y: 176 }),
    { id: "program", name: "ALM program", nick: "control panel", lines: ["The fixed menu of moves", "a relayer can ask for."], x: 290, y: 176, w: 160 },
    { id: "reserve", name: "Reserve", nick: "vault + meter", lines: ["One per token: its balance", "and an outflow limit."], x: 550, y: 176, w: 160, own: true },
    { ...SHARED.venues({ x: 790, y: 176, w: 150 }), lines: ["Drift, Kamino, swaps,", "CCTP and LayerZero."] },
    { ...SHARED.freezer({ x: 20, y: 330 }), lines: ["Freezes the controller.", "Sets and moves nothing."] },
    { id: "permission", name: "Permission", nick: "badge", lines: ["One per account: flags for", "what it can do, if Active."], x: 290, y: 330, w: 160, own: true },
    { id: "integration", name: "Integration", nick: "gate + meter", lines: ["One per venue, each with", "its own limit."], x: 550, y: 330, w: 160, own: true },
  ],
  edges: [
    {
      from: "admin", to: "program", kind: "rule", grants: ["DEFAULT_ADMIN_ROLE on permission"], label: "grants permissions · sets limits · adds integrations",
      rule: "a Permission with can_manage_permissions and can_manage_reserves_and_integrations (the Default Admin Role)", d: "M500 90 V132", lx: 510, ly: 116,
    },
    { from: "relayer", to: "program", kind: "flow", grants: ["RELAYER on permission"], label: "asks for a move", rule: "each instruction is signed by the holder of a Permission account", d: "M180 213 H284", lx: 225, ly: 204, align: "middle" },
    {
      from: "program", to: "permission", kind: "flow", label: "checks the caller's flags",
      rule: "a Permission's flags (can_execute_swap, can_reallocate, can_invoke_external_transfer, …) count only while its status is Active", d: "M370 256 V324", lx: 380, ly: 294,
    },
    { from: "program", to: "reserve", kind: "flow", label: "draws from", rule: "a Reserve holds status, slope, max_outflow and what is available for its mint", d: "M450 205 H544", lx: 497, ly: 196, align: "middle", both: true },
    {
      from: "program", to: "integration", kind: "flow", label: "checks, then draws down",
      rule: "an Integration holds status, slope, max_outflow and what is available for its venue", d: "M456 235 H500 V367 H544", lx: 508, ly: 300, both: true,
    },
    { from: "reserve", to: "venues", kind: "flow", label: "sends", rule: "the controller's authority, a program-derived address, signs the token move", d: "M710 213 H784", lx: 760, ly: 204, align: "middle" },
    {
      from: "freezer", to: "program", kind: "stop", grants: ["FREEZER on permission"], label: "freezes the controller",
      rule: "a Permission with can_freeze_controller sets the Controller account's status to Frozen", d: "M180 367 H230 V235 H284", lx: 222, ly: 300, align: "end",
    },
  ],
};
