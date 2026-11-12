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
import type { KeyRoutes } from "./pauKeyRoutes.ts";
import type { OnchainStep } from "./pauPending.ts";
import { isSvmChain } from "./pauRegistry.ts";
import { operatorFallsShort, operatorReaches } from "./pauRouteText.ts";
import { setOrder } from "./pauValueDate.ts";

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
  "chain-newer": { group: "atlas", text: "The chain value was set after the atlas last wrote it, and they disagree." },
  "atlas-newer": { group: "spell", text: "The atlas wrote the value after the chain last set it, and they disagree." },
  "not-set": { group: "spell", text: "The atlas states a limit no RateLimits contract on the chain has ever set." },
  "spell-executed": { group: "spell-executed", text: "The spell the atlas change's pull request names has executed, and did not set this value." },
  "spell-lapsed": { group: "spell", text: "The spell the atlas change belongs to never carried it: its executive expired uncast, was filed without the change's Prime poll, or the vote record has none." },
  "off-spell": { group: "spell", text: "The atlas change went through a Prime poll for an artifact or Sky Core item, which no Prime spell carries, and the chain does not hold the value." },
  "poll-rejected": { group: "atlas", text: "The Prime poll the atlas change went through did not pass, yet the atlas states the value." },
  "spell-set-differently": { group: "ambiguous", text: "The spell the atlas change's pull request names set this limit, to a value other than the atlas states." },
  "atlas-recorded-differently": { group: "atlas", text: "The atlas change records a spell that had already executed, and that spell set this limit to a value other than the atlas states." },
  "atlas-recorded-unmade": { group: "atlas", text: "The atlas change records a spell that had already executed, and that spell did not set this value." },
  "operator-not-applied": { group: "spell", text: "The atlas changed the value after the chain last set it, no spell carries the change, and by the atlas's Operator rules (cited in the row's route line) the Operator can bring the limit to the stated value through the Configurator, but has not." },
  "beyond-operator": { group: "atlas", text: "The atlas change is an item no spell carries, and the stated value is beyond what the atlas's Operator rules (cited in the row's route line) let the Operator set through the Configurator." },
  "not-wired": { group: "spell", text: "The controller holds the CONTROLLER role on neither its ALM proxy nor its rate limits, so it cannot move funds." },
  "partly-wired": { group: "spell", text: "The controller holds the CONTROLLER role on only one of its ALM proxy and its rate limits." },
  "no-key": { group: "detail", text: "The atlas states no Rate Limit ID for this value, and nothing the document or its instance names derives a key the contract holds." },
  "no-account": { group: "detail", text: "The Solana program holds no account for this value: it names no listed Integration, Reserve, swap or bridge, or it is a limit on a side the program never limits." },
  "rejected-claim": { group: "registry", text: "The atlas names this address for a role the chain contradicts." },
  "role-not-held": { group: "registry", text: "The atlas names this account to a role, and the chain says it does not hold it now: its Permission is suspended." },
  "several-keys": { group: "ambiguous", text: "More than one key could be this value's, and they do not all agree with the atlas." },
  "units-unknown": { group: "ambiguous", text: "The limit's token units cannot be pinned down, and the stated amount fits the chain value at more than one scale." },
  "order-unknown": { group: "ambiguous", text: "The atlas and the chain disagree, and the dates cannot say which changed last." },
} as const satisfies Record<string, { group: AuditGroup; text: string }>;

export type AuditReason = keyof typeof AUDIT_REASONS;

/** When each side last moved, as ISO timestamps: the chain's last set of the key and the atlas change that wrote the value; null when unknown. */
export interface MoveDates {
  chain: string | null;
  atlas: string | null;
  /** The chain set the key before this time, the start of the window its history was read over (`SetAt.before`). */
  chainBefore?: string;
}

/** A disagreement placed by which side moved last (`setOrder`, the rule the on-chain step follows too); an unknown time, or the same instant, places it nowhere. */
function byOrder(d: MoveDates): AuditReason {
  const order = setOrder({ time: d.chain ?? "", before: d.chainBefore }, d.atlas);
  return order === "chain" ? "chain-newer" : order === "atlas" ? "atlas-newer" : "order-unknown";
}

/** Whether a slope's limit is off on the chain and the atlas states its maxAmount as 0 too (the matching maxAmount check of the same key). */
export function switchedOffSlope(c: ValueCheck, all: ValueCheck[]): boolean {
  if (c.field !== "slope" || c.limit?.data?.maxAmount !== "0") return false;
  return all.some((o) => o.field === "maxAmount" && o.instance === c.instance && o.key === c.key && o.contract === c.contract && o.status === "match");
}

/** A change no spell carries (an off-spell item, or a PR that names no spell), placed by whether the Operator can reach the stated value. */
function offSpell(step: OnchainStep | null, routes: KeyRoutes | undefined, otherwise: AuditReason): AuditReason {
  if (operatorReaches(routes)) return "operator-not-applied";
  if (step?.kind === "off-spell" && operatorFallsShort(routes)) return "beyond-operator";
  return otherwise;
}

/**
 * A value the atlas moved last (`otherwise` "atlas-newer"), or a limit the
 * chain never set ("not-set"), placed by what became of the spell its atlas
 * change belongs to, or, where no spell carries it, by the Operator's reach (a
 * PR that names no spell counts only for a value the chain has set).
 */
function spellReason(step: OnchainStep | null, routes: KeyRoutes | undefined, otherwise: "atlas-newer" | "not-set"): AuditReason {
  if (step?.kind === "executed") return step.recorded ? "atlas-recorded-unmade" : "spell-executed";
  if (step?.kind === "lapsed") return "spell-lapsed";
  if (step?.kind === "rejected") return "poll-rejected";
  if (step?.kind === "off-spell") return offSpell(step, routes, "off-spell");
  return step?.kind === "unnamed" && otherwise === "atlas-newer" ? offSpell(step, routes, otherwise) : otherwise;
}

/**
 * The audit reason for one checked value, or null when it needs no audit.
 * `step` is what became of the spell the atlas change names; `routes`, who can
 * change the limit and whether the Operator can reach the stated value.
 */
export function checkReason(c: ValueCheck, all: ValueCheck[], dates: MoveDates, step: OnchainStep | null = null, routes?: KeyRoutes): AuditReason | null {
  if (c.status === "mismatch") {
    if (switchedOffSlope(c, all)) return "switched-off-slope";
    if (step?.kind === "set") return step.recorded ? "atlas-recorded-differently" : "spell-set-differently";
    const order = byOrder(dates);
    return order === "atlas-newer" ? spellReason(step, routes, "atlas-newer") : order;
  }
  if (c.status === "not-set") return spellReason(step, routes, "not-set");
  if (c.status === "no-key") return c.kind === "svm" || (c.chain !== null && isSvmChain(c.chain)) ? "no-account" : "no-key";
  if (c.status === "ambiguous") return "several-keys";
  if (c.status === "units-unknown") return "units-unknown";
  return null;
}

