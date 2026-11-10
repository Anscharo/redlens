// Why a PAU value needs an expert's attention, and which group of the PAU
// values audit report (pauAuditIndex.ts) it belongs to. A group is a judgement
// the data supports, never more: which side moved last is read from dates (the
// chain's last set against when the atlas wrote the value), a value the dates
// cannot place is ambiguous rather than guessed, and "a spell may not have
// executed yet" is never said where the spell the atlas change's pull request
// names has executed (pauPending.ts `onchainStep`), nor for a key the Operator
// may set without a spell when the pull request names none. Values the reader itself
// cannot judge yet (not read, no deployment, unparsed text, unknown chain) and
// values that match or are not stated are not audit items.
import type { ValueCheck } from "./pauAtlasValues.ts";
import type { OnchainStep } from "./pauPending.ts";

export const AUDIT_GROUPS = [
  { key: "atlas", label: "Atlas probably out of date", hint: "The chain moved after the atlas last stated the value, or the atlas contradicts itself." },
  { key: "spell", label: "Spell or Operator may not have acted yet", hint: "The atlas moved after the chain was last set, or states something the chain has not done, and the spell its pull request names has not executed, or none is named." },
  { key: "spell-executed", label: "Spell executed without the change", hint: "The spell the atlas change's pull request names has executed without setting the value: the atlas may be ahead of what was done, or the spell left it out." },
  { key: "detail", label: "Atlas lacks the detail to check", hint: "The atlas does not say enough to find the value on chain." },
  { key: "registry", label: "Registry conflicts", hint: "Atlas statements about which contract plays which role that the chain contradicts." },
  { key: "ambiguous", label: "Ambiguous", hint: "The chain and the atlas disagree, but the data cannot say which side is wrong." },
] as const;

export type AuditGroup = (typeof AUDIT_GROUPS)[number]["key"];

export const AUDIT_REASONS = {
  "switched-off-slope": { group: "atlas", text: "The limit is switched off on both sides (maxAmount 0), but the atlas still states a slope the contract does not hold." },
  "chain-newer": { group: "atlas", text: "The chain value was set after the atlas document last changed, and they disagree." },
  "atlas-newer": { group: "spell", text: "The atlas document changed after the chain value was last set, and they disagree." },
  "not-set": { group: "spell", text: "The atlas states a limit no RateLimits contract on the chain has ever set." },
  "spell-executed": { group: "spell-executed", text: "The spell the atlas change's pull request names has executed, and did not set this value." },
  "spell-lapsed": { group: "spell", text: "The spell the atlas change's pull request names never executed: its executive expired uncast, or the vote record has none for that date." },
  "spell-set-differently": { group: "ambiguous", text: "The spell the atlas change's pull request names set this limit, to a value other than the atlas states." },
  "operator-not-applied": { group: "spell", text: "The atlas changed the value after the chain last set it, its pull request names no spell, and the Operator may set this limit without one (BeamState holds a default for it) but has not." },
  "not-wired": { group: "spell", text: "The controller holds the CONTROLLER role on neither its ALM proxy nor its rate limits, so it cannot move funds." },
  "partly-wired": { group: "spell", text: "The controller holds the CONTROLLER role on only one of its ALM proxy and its rate limits." },
  "no-key": { group: "detail", text: "The atlas states no Rate Limit ID for this value, and nothing the document or its instance names derives a key the contract holds." },
  "rejected-claim": { group: "registry", text: "The atlas names this address for a role the chain contradicts." },
  "several-keys": { group: "ambiguous", text: "More than one key could be this value's, and they do not all agree with the atlas." },
  "units-unknown": { group: "ambiguous", text: "The limit's token units cannot be pinned down, and the stated amount fits the chain value at more than one scale." },
  "order-unknown": { group: "ambiguous", text: "The atlas and the chain disagree, and the dates cannot say which changed last." },
} as const satisfies Record<string, { group: AuditGroup; text: string }>;

export type AuditReason = keyof typeof AUDIT_REASONS;

/** When each side last moved, as YYYY-MM-DD; null when unknown. */
export interface MoveDates {
  chain: string | null;
  atlas: string | null;
}

/** A disagreement placed by which side moved last; the same day, or a missing date, places it nowhere. */
function byOrder(d: MoveDates): AuditReason {
  if (!d.chain || !d.atlas || d.chain === d.atlas) return "order-unknown";
  return d.chain > d.atlas ? "chain-newer" : "atlas-newer";
}

/** Whether a slope's limit is off on the chain and the atlas states its maxAmount as 0 too (the matching maxAmount check of the same key). */
export function switchedOffSlope(c: ValueCheck, all: ValueCheck[]): boolean {
  if (c.field !== "slope" || c.limit?.data?.maxAmount !== "0") return false;
  return all.some((o) => o.field === "maxAmount" && o.instance === c.instance && o.key === c.key && o.contract === c.contract && o.status === "match");
}

/** A disagreement the atlas moved last, placed by what became of the spell its pull request names. */
function atlasNewer(step: OnchainStep | null, operator: boolean): AuditReason {
  if (step?.kind === "executed") return "spell-executed";
  if (step?.kind === "lapsed") return "spell-lapsed";
  return step?.kind === "unnamed" && operator ? "operator-not-applied" : "atlas-newer";
}

/**
 * The audit reason for one checked value, or null when it needs no audit.
 * `step` is what became of the spell the atlas change names; `operator`,
 * whether the Operator may set the key without a spell.
 */
export function checkReason(c: ValueCheck, all: ValueCheck[], dates: MoveDates, step: OnchainStep | null = null, operator = false): AuditReason | null {
  if (c.status === "mismatch") {
    if (switchedOffSlope(c, all)) return "switched-off-slope";
    if (step?.kind === "set") return "spell-set-differently";
    const order = byOrder(dates);
    return order === "atlas-newer" ? atlasNewer(step, operator) : order;
  }
  if (c.status === "not-set") return step?.kind === "executed" ? "spell-executed" : step?.kind === "lapsed" ? "spell-lapsed" : "not-set";
  if (c.status === "no-key") return "no-key";
  if (c.status === "ambiguous") return "several-keys";
  if (c.status === "units-unknown") return "units-unknown";
  return null;
}

const CONTENT = new Set(["added", "modified"]);

/** A document's last content change (added, or a non-cosmetic edit) as YYYY-MM-DD, from its history entries; null when none. */
export function lastContentChange(entries: readonly { date: string; changeType: string; changeKind?: string }[]): string | null {
  const days = entries.filter((e) => CONTENT.has(e.changeType) && e.changeKind !== "lint" && e.changeKind !== "typo").map((e) => e.date.slice(0, 10));
  return days.length ? days.sort().at(-1)! : null;
}
