// The words for what governance did about an atlas change (pauPending.ts),
// shared by the reader's "Atlas vs contract" table, the Radar marks, the PAU
// values audit and its CSV, so each says the same thing, naming the pull
// request and the spell it links. Pure.
import { explorerTxUrl } from "./explorer.ts";
import type { Named, OnchainStep, PendingOnchain, PendingStep, SpellRef } from "./pauPending.ts";

const chainName = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "a time not read");
const prName = (pr: number | null) => (pr ? `atlas PR #${pr}` : "the atlas change");

/** An executive by date and title. */
export const spellName = (s: SpellRef): string => `the ${s.date} executive "${s.title}"`;

/** Which spell the change that wrote the value names. */
const namedText = (n: Named) => `${prName(n.pr)} (${n.atlasChanged}) names the ${n.date} spell`;

/** What a pending change is waiting on, as a clause. */
export function pendingStepText(step: PendingStep): string {
  switch (step.kind) {
    case "unfiled":
      return "its executive is not filed yet";
    case "uncast":
      return `${spellName(step.spell)} is not yet cast`;
    case "queued":
      return `${spellName(step.spell)} has executed and an action set is queued on the ${chainName(step.chain)} Executor, executable from ${when(step.at)}`;
    default:
      return `${spellName(step.spell)} executed on ${step.executed}; its changes are still being read`;
  }
}

/** A pending change in one sentence: the link from the atlas to the spell, what the chain is waiting on, and until when. */
export const pendingSummary = (p: PendingOnchain): string => `on-chain update pending: ${namedText(p)}; ${pendingStepText(p.step)}; expected by ${p.expectedBy}`;

/** A step as one clause. */
export function stepText(step: OnchainStep): string {
  switch (step.kind) {
    case "pending":
      return `${namedText(step.pending)}; ${pendingStepText(step.pending.step)}; expected by ${step.pending.expectedBy}`;
    case "set":
      return `${namedText(step.named)}, and ${spellName(step.spell)} set this limit on ${chainName(step.chain)}, to a value other than the atlas states`;
    case "executed":
      return `${namedText(step.named)}, and ${spellName(step.spell)} executed${step.executed ? ` on ${step.executed}` : ""} without setting this limit`;
    case "lapsed":
      return step.spell ? `${namedText(step.named)}, and ${spellName(step.spell)} expired without being cast` : `${namedText(step.named)}, and the vote record has no executive for it`;
    default:
      return `${prName(step.pr)} (${step.atlasChanged}), which wrote this value, names no spell`;
  }
}

/** Where a step can be checked: the transaction that set or queued it, else the executive's page; null where neither exists. */
export function stepHref(step: OnchainStep): string | null {
  if (step.kind === "set") return explorerTxUrl(step.chain, step.tx);
  if (step.kind === "pending") return step.pending.step.kind === "queued" ? explorerTxUrl(step.pending.step.chain, step.pending.step.tx) : step.pending.step.kind === "unfiled" ? null : step.pending.step.spell.url;
  if (step.kind === "executed") return step.spell.url;
  return step.kind === "lapsed" ? (step.spell?.url ?? null) : null;
}
