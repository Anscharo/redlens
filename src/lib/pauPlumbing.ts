// The static plumbing of a PAU, as the diagram at the top of a Prime's PAUs page
// draws it: who holds which part, and which part answers to which, once per
// controller generation. Every edge is an access rule the contracts' own source
// states, so a picture holds for any deployment of its generation. Pure.
import type { PauKind } from "./pauRegistry.ts";
import { DIAMOND_PLUMBING } from "./pauPlumbingDiamond.ts";
import { MONOLITHIC_PLUMBING } from "./pauPlumbingMonolithic.ts";
import type { Plumbing, PlumbingKind } from "./pauPlumbingParts.ts";

export * from "./pauPlumbingParts.ts";

/** The generations the plumbing diagram draws: the EVM ones. */
export type PlumbingArch = Exclude<PauKind, "svm">;

export const PLUMBING: Record<PlumbingArch, Plumbing> = { monolithic: MONOLITHIC_PLUMBING, diamond: DIAMOND_PLUMBING };

/** The toggle's order and wording. */
export const PLUMBING_KINDS: { kind: PlumbingArch; label: string }[] = [
  { kind: "monolithic", label: "Monolithic controller" },
  { kind: "diamond", label: "Diamond PAU" },
];

export const PLUMBING_KEY: Record<PlumbingKind, string> = {
  flow: "a move on its way to the funds",
  rule: "sets the rules",
  stop: "can cut off",
};
