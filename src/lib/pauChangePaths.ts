// The ways a PAU's configuration changes, as the second diagram on a Prime's
// PAUs page draws them: one lane per path, each ending at what that path can
// change. Each `rule` is the check in the StarGuard, Executor, Configurator and
// controller sources; the change history credits every stored change to one of
// these paths (src/server/pau/origin.ts). Pure.
import { SVM_CHANGE_PLUMBING } from "./pauChangePathsSvm.ts";
import type { PauKind } from "./pauRegistry.ts";
import type { Plumbing, PlumbingNode } from "./pauPlumbingParts.ts";

const COL = [170, 360, 550, 740] as const;
const ROW = [34, 134, 244, 344] as const;
const step = (id: string, name: string, nick: string, lines: [string, string], col: number, row: number): PlumbingNode => ({ id, name, nick, lines, x: COL[col], y: ROW[row], w: 160 });
const target = (id: string, name: string, lines: [string, string], row: number, h?: number): PlumbingNode => ({ id, name, nick: "what changes", lines, x: 950, y: ROW[row], w: 180, h });

export const CHANGE_PLUMBING: Plumbing = {
  id: "pau-change-paths",
  title: "EVM chains",
  w: 1150,
  h: 440,
  frame: { x: 938, y: 6, w: 204, h: 424 },
  frameLabel: "PAU",
  summary:
    "A PAU changes three ways. An executive vote's spell reaches it through the StarGuard and the Prime's SubProxy on Ethereum, or over a bridge and an Executor on other chains, and can change anything. An operator can adjust rate limits through the Configurator within set bounds, without a spell. A freezer can remove a relayer at once.",
  lanes: [
    { y: ROW[0], title: "By spell", sub: "on Ethereum" },
    { y: ROW[1], title: "By spell", sub: "on other chains" },
    { y: ROW[2], title: "Without a spell", sub: "where BeamState allows it" },
    { y: ROW[3], title: "Emergency", sub: "no vote" },
  ],
  nodes: [
    step("vote", "Executive vote", "sky governance", ["Token holders approve", "one spell for the change."], 0, 0),
    step("spell", "Spell", "work order", ["Cast once, after the", "governance delay."], 1, 0),
    step("starGuard", "StarGuard", "handoff", ["Holds the Prime's payload", "until someone executes it."], 2, 0),
    step("admin", "Admin", "owner · subproxy", ["The Prime's SubProxy", "runs the payload."], 3, 0),
    step("executor", "Executor", "owner · that chain", ["Queues it, waits out its", "delay, then executes."], 3, 1),
    step("operator", "Operator", "cbeam", ["An account BeamState", "lets adjust this PAU."], 2, 2),
    step("configurator", "Configurator", "regulator", ["Raises a limit by capped", "steps; lowers it any time."], 3, 2),
    step("freezer", "Freezer", "emergency stop", ["Acts at once with its", "own key. Sets nothing."], 3, 3),
    target("anything", "Anything", ["Roles, rate limits,", "parameters, facets."], 0, 174),
    target("limits", "Rate limits", ["Only limits, and only", "inside the set bounds."], 2),
    target("relayers", "Relayers", ["Only removes one from", "the list of relayers."], 3),
  ],
  edges: [
    { from: "vote", to: "spell", kind: "rule", label: "", rule: "the spell casts through the governance pause", d: "M330 71 H354", lx: 0, ly: 0 },
    { from: "spell", to: "starGuard", kind: "rule", label: "", rule: "StarGuard.plot is auth: only core governance plots a payload", d: "M520 71 H544", lx: 0, ly: 0 },
    { from: "starGuard", to: "admin", kind: "rule", label: "", rule: "StarGuard.exec is open to anyone and runs the plotted payload through the SubProxy", d: "M710 71 H734", lx: 0, ly: 0 },
    { from: "admin", to: "anything", kind: "rule", label: "", rule: "DEFAULT_ADMIN_ROLE on the PAU's contracts", d: "M900 71 H944", lx: 0, ly: 0 },
    {
      from: "spell", to: "executor", kind: "rule", label: "relayed over a bridge",
      rule: "Executor.queue is onlyRole(SUBMISSION_ROLE); execute is open to anyone once the delay has passed", d: "M440 108 V171 H734", lx: 450, ly: 163,
    },
    { from: "executor", to: "anything", kind: "rule", label: "", rule: "DEFAULT_ADMIN_ROLE on the PAU's contracts on that chain", d: "M900 171 H944", lx: 0, ly: 0 },
    { from: "operator", to: "configurator", kind: "rule", label: "", rule: "Configurator.setRateLimit asks BeamState.rateLimitsCBeams(rateLimits, caller)", d: "M710 281 H734", lx: 0, ly: 0 },
    {
      from: "configurator", to: "limits", kind: "rule", label: "", optional: true,
      rule: "Configurator.setRateLimit caps a raise at BeamState's default or maxChange, once per hop", d: "M900 281 H944", lx: 0, ly: 0,
    },
    { from: "freezer", to: "relayers", kind: "stop", label: "", rule: "onlyRole(FREEZER) on removeRelayer; on a Diamond, a revoker's removeActor on the AdministeredAgent", d: "M900 381 H944", lx: 0, ly: 0 },
  ],
};

/** The change diagrams a Prime's page shows: one per family of controller it runs, EVM first. */
export function changePlumbings(kinds: readonly PauKind[]): Plumbing[] {
  const evm = kinds.some((k) => k !== "svm") ? [CHANGE_PLUMBING] : [];
  return kinds.includes("svm") ? [...evm, { ...SVM_CHANGE_PLUMBING, title: "Solana" }] : evm;
}
