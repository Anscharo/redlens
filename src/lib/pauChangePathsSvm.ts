// The ways a Solana ALM Controller's configuration changes, drawn like the EVM
// lanes (pauChangePaths.ts). Governance reaches the program over LayerZero; it
// has no Configurator and no Executor. Each `rule` restates what the origin
// rule (src/server/pau/origin-svm.ts) and the route reader (pauSvmRoutes.ts)
// rest on. Pure.
import type { Plumbing, PlumbingNode } from "./pauPlumbingParts.ts";

const COL = [170, 360, 550, 740] as const;
const ROW = [34, 144, 244] as const;
const step = (id: string, name: string, nick: string, lines: [string, string], col: number, row: number): PlumbingNode => ({ id, name, nick, lines, x: COL[col], y: ROW[row], w: 160 });
const target = (id: string, name: string, lines: [string, string], row: number, h?: number): PlumbingNode => ({ id, name, nick: "what changes", lines, x: 950, y: ROW[row], w: 180, h });

export const SVM_CHANGE_PLUMBING: Plumbing = {
  id: "pau-change-paths-svm",
  w: 1150,
  h: 340,
  frame: { x: 938, y: 6, w: 204, h: 324 },
  frameLabel: "ALM program",
  summary:
    "A Solana ALM Controller changes three ways. An executive vote's spell has the Prime's SubProxy send a LayerZero governance message, which the governance program on Solana receives and runs as the Prime's authority; it can change anything. Any other account holding an active admin Permission can change the same things directly. A freezer can freeze the controller.",
  lanes: [
    { y: ROW[0], title: "By spell", sub: "relayed from Ethereum" },
    { y: ROW[1], title: "Directly", sub: "no vote" },
    { y: ROW[2], title: "Emergency", sub: "no vote" },
  ],
  nodes: [
    step("vote", "Executive vote", "sky governance", ["Token holders approve", "one spell for the change."], 0, 0),
    step("spell", "Spell", "work order", ["Cast once, after the", "governance delay."], 1, 0),
    step("sender", "LayerZero sender", "dispatch · ethereum", ["The Prime's SubProxy sends", "a governance message."], 2, 0),
    step("receiver", "Governance program", "owner · solana", ["Receives it and runs it as", "the Prime's authority."], 3, 0),
    step("otherAdmin", "Other admin key", "spare key", ["Any other account with an", "active admin Permission."], 3, 1),
    step("freezer", "Freezer", "emergency stop", ["Acts at once with its", "own key. Sets nothing."], 3, 2),
    target("anything", "Anything", ["Permissions, limits,", "integrations."], 0, 184),
    target("controller", "Controller", ["Only freezes it, which", "stops its moves."], 2),
  ],
  edges: [
    { from: "vote", to: "spell", kind: "rule", label: "", rule: "the spell casts through the governance pause", d: "M330 71 H354", lx: 0, ly: 0 },
    { from: "spell", to: "sender", kind: "rule", label: "", rule: "the spell's SubProxy calls the Ethereum LayerZero Governance Sender, which emits GovernanceCallSent", d: "M520 71 H544", lx: 0, ly: 0 },
    { from: "sender", to: "receiver", kind: "rule", label: "", rule: "LzReceive with the same guid runs the call as that SubProxy's CPI authority; anyone can submit it", d: "M710 71 H734", lx: 0, ly: 0 },
    { from: "receiver", to: "anything", kind: "rule", label: "", rule: "the CPI authority holds a Permission granting the Default Admin Role", d: "M900 71 H944", lx: 0, ly: 0 },
    { from: "otherAdmin", to: "anything", kind: "rule", label: "", optional: true, rule: "any other holder of an active Default Admin Role Permission signs the change itself", d: "M900 181 H944", lx: 0, ly: 0 },
    { from: "freezer", to: "controller", kind: "stop", label: "", rule: "a Permission with can_freeze_controller sets the Controller account's status to Frozen", d: "M900 281 H944", lx: 0, ly: 0 },
  ],
};
