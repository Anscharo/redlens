// The words for what governance did about an atlas change (pauPending.ts),
// shared by the reader's "Atlas vs contract" table, the Radar marks, the PAU
// values audit and its CSV, so each says the same thing, naming the pull
// request, the Prime poll it went through and the spell that carries it. Pure.
import { explorerTxUrl } from "./explorer.ts";
import type { ChainChange, Named, OnchainStep, PendingOnchain, PendingStep, SpellRef } from "./pauPending.ts";

const chainName = (chain: string) => chain.charAt(0).toUpperCase() + chain.slice(1);
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "a time not read");
const prName = (pr: number | null) => (pr ? `atlas PR #${pr}` : "the atlas change");

/** An executive by date and title. */
export const spellName = (s: SpellRef): string => `the ${s.date} executive "${s.title}"`;

/** A Prime Snapshot poll's page. */
export const pollUrl = (p: NonNullable<Named["poll"]>) => `https://snapshot.box/#/s:${p.space}/proposal/${p.id}`;

/** How the change that wrote the value is linked to its spell: through its Prime poll, or by the date its PR names. */
const namedText = (n: Named) =>
  n.poll ? `${prName(n.pr)} (${n.atlasChanged}) went through the ${n.poll.space} poll "${n.poll.title}"` : `${prName(n.pr)} (${n.atlasChanged}) names the ${n.date} spell`;

/** What a pending change is waiting on, as a clause. */
export function pendingStepText(step: PendingStep): string {
  switch (step.kind) {
    case "polling":
      return "its poll is still open";
    case "unfiled":
      return "the executive for its spell is not filed yet";
    case "uncast":
      return `${spellName(step.spell)}, which carries it, is not yet cast`;
    case "queued":
      if (step.via === "layerzero") return `${spellName(step.spell)} has executed and a LayerZero governance message sent since has not been received on Solana yet`;
      return `${spellName(step.spell)} has executed and an action set is queued on the ${chainName(step.chain)} Executor, executable from ${when(step.at)}`;
    default:
      return `${spellName(step.spell)} executed on ${step.executed}; its changes are still being read`;
  }
}

/** A pending change in one sentence: the link from the atlas to the spell, what the chain is waiting on, and until when. */
export const pendingSummary = (p: PendingOnchain): string => `on-chain update pending: ${namedText(p)}; ${pendingStepText(p.step)}; expected by ${p.expectedBy}`;

/** Who made a chain change the atlas has not recorded, and when. */
function changeText(ch: ChainChange): string {
  const on = `on ${chainName(ch.chain)} on ${ch.setOn}`;
  if (ch.by.kind === "operator") return `the Operator set this limit ${on}`;
  if (ch.by.kind === "spell") return ch.by.spell ? `the ${ch.by.spell.date} spell set this limit ${on}` : `a spell set this limit ${on}`;
  return `the chain set this limit ${on}`;
}

/** What a spell that ran did to the value: as an edit that recorded it (it had executed first), or as the spell carrying the edit. */
const ranText = (step: Extract<OnchainStep, { kind: "set" | "executed" }>, what: string) =>
  step.recorded ? `${namedText(step.named)}; ${spellName(step.spell)} had already executed: the atlas records it, but it ${what}` : `${namedText(step.named)}, and ${spellName(step.spell)} ${what}`;

const LAPSED: Record<Extract<OnchainStep, { kind: "lapsed" }>["why"], (s: SpellRef | null) => string> = {
  expired: (s) => `${s ? spellName(s) : "its executive"} expired without being cast`,
  "not-carried": (s) => `${s ? spellName(s) : "its spell's executive"} was filed without it`,
  none: () => "the vote record has no executive for it",
};

/** A step as one clause. */
export function stepText(step: OnchainStep): string {
  switch (step.kind) {
    case "pending":
      return `${namedText(step.pending)}; ${pendingStepText(step.pending.step)}; expected by ${step.pending.expectedBy}`;
    case "set":
      return ranText(step, `set this limit on ${chainName(step.chain)}, to a value other than the atlas states`);
    case "executed":
      return ranText(step, `executed${step.executed ? ` on ${step.executed}` : ""} without setting this limit`);
    case "lapsed":
      return `${namedText(step.named)}, and ${LAPSED[step.why](step.spell)}`;
    case "off-spell":
      return `${namedText(step.named)}, an artifact or Sky Core item that no Prime spell carries`;
    case "rejected":
      return `${namedText(step.named)}, which did not pass`;
    case "recording":
      return `${changeText(step.change)}, after the atlas last wrote it; open atlas PR #${step.pr.number} belongs to that spell and is still to merge`;
    case "unrecorded":
      return step.missedBy
        ? `${changeText(step.change)}, and atlas PR #${step.missedBy.pr} (${step.missedBy.date}), which belongs to that spell, changed this document but not this value`
        : `${changeText(step.change)}, after the atlas last wrote it, and no open atlas PR belongs to ${step.change.by.kind === "spell" ? "that spell" : "the change"}`;
    default:
      return `${prName(step.pr)} (${step.atlasChanged}), which wrote this value, names no spell and went through no Prime poll`;
  }
}

/** A pending step in one sentence, either side: the on-chain update still coming, or the atlas update. */
export const pendingText = (step: OnchainStep): string =>
  step.kind === "pending" ? pendingSummary(step.pending) : step.kind === "recording" ? `atlas update pending: ${stepText(step)}` : stepText(step);

/** The page a pending step can be checked on. */
function pendingHref(p: PendingOnchain): string | null {
  const s = p.step;
  if (s.kind === "queued") return explorerTxUrl(s.chain, s.tx);
  if (s.kind === "uncast" || s.kind === "reading") return s.spell.url;
  return p.poll ? pollUrl(p.poll) : null;
}

/** Where a step can be checked: the transaction that set or queued it, else the executive's or the poll's page; null where none exists. */
export function stepHref(step: OnchainStep): string | null {
  if (step.kind === "set") return explorerTxUrl(step.chain, step.tx);
  if (step.kind === "recording") return step.pr.url;
  if (step.kind === "unrecorded") return explorerTxUrl(step.change.chain, step.change.tx);
  if (step.kind === "pending") return pendingHref(step.pending);
  if (step.kind === "executed") return step.spell.url;
  if (step.kind === "lapsed" && step.spell) return step.spell.url;
  return step.kind !== "unnamed" && step.named.poll ? pollUrl(step.named.poll) : null;
}
