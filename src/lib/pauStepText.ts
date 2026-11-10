// The words for an on-chain step (pauPending.ts), shared by the reader's
// "Atlas vs contract" table, the Radar marks, the PAU values audit and its
// CSV, so each says the same thing about what a change is waiting on. Pure.
import { explorerTxUrl } from "./explorer.ts";
import type { OnchainStep, PendingOnchain, PendingStep, Route, SpellRef } from "./pauPending.ts";

const chainName = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "a time not read");

/** An executive by title and date, or by what is known of it. */
export const spellName = (s: SpellRef): string => (s.title ? `the ${s.date ? `${s.date} ` : ""}executive "${s.title}"` : s.date ? `the ${s.date} executive` : "a spell");

const WINDOW: Record<Route, string> = {
  operator: "the Operator may set this limit without a spell (BeamState holds a default for it), and the next spells are still within the expected delay",
  spell: "the next spells are still within the expected delay",
  relayed: "the next spells, and the relay to this chain, are still within the expected delay",
};

/** What a pending change is waiting on, as a clause. */
export function pendingStepText(step: PendingStep, route: Route): string {
  switch (step.kind) {
    case "queued":
      return `an action set is queued on the ${chainName(step.chain)} Executor, executable from ${when(step.at)}`;
    case "plotted":
      return `a star spell is plotted on the Prime's StarGuard, executable until ${when(step.at)}`;
    case "uncast":
      return `${spellName(step.spell)}, which names this Prime, is not yet cast`;
    default:
      return WINDOW[route];
  }
}

/** A pending change in one sentence: when the atlas moved, what the chain is waiting on, and until when. */
export const pendingSummary = (p: PendingOnchain): string =>
  `on-chain update pending: the atlas changed this value on ${p.atlasChanged}, after the chain last set it; ${pendingStepText(p.step, p.route)}; expected on chain by ${p.expectedBy}`;

/** A step as one clause: what is still coming, or the spell that went by without the change. */
export function stepText(step: OnchainStep): string {
  if (step.kind === "pending") return `${pendingStepText(step.pending.step, step.pending.route)}; expected by ${step.pending.expectedBy}`;
  const who = step.actionsSet !== undefined ? `action set ${step.actionsSet}, relayed to ${chainName(step.chain)} by a spell not proven yet,` : spellName(step.spell);
  return `${who} changed this deployment on ${chainName(step.chain)} without it`;
}

/** Where a step can be checked: the transaction that queued, plotted or made it, or the executive's page; null for a step the window alone places. */
export function stepHref(step: OnchainStep): string | null {
  if (step.kind === "executed") return explorerTxUrl(step.chain, step.tx);
  const s = step.pending.step;
  if (s.kind === "queued") return explorerTxUrl(s.chain, s.tx);
  if (s.kind === "plotted") return explorerTxUrl("ethereum", s.tx);
  return s.kind === "uncast" ? s.spell.url : null;
}
