// Why a PAU value needs an expert's attention, and which group of the PAU
// values audit report (pauAuditIndex.ts) it belongs to. A group is a judgement
// the data supports, never more: which side moved last is read from dates (the
// chain's last set against the atlas document's last change), and a value the
// dates cannot place is ambiguous rather than guessed. Values the reader itself
// cannot judge yet (not read, no deployment, unparsed text, unknown chain) and
// values that match or are not stated are not audit items.
import type { ValueCheck } from "./pauAtlasValues.ts";

export const AUDIT_GROUPS = [
  { key: "atlas", label: "Atlas probably out of date", hint: "The chain moved after the atlas last stated the value, or the atlas contradicts itself." },
  { key: "spell", label: "Spell may not have executed yet", hint: "The atlas moved after the chain was last set, or states something the chain has not done." },
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

/** The audit reason for one checked value, or null when it needs no audit. */
export function checkReason(c: ValueCheck, all: ValueCheck[], dates: MoveDates): AuditReason | null {
  if (c.status === "mismatch") return switchedOffSlope(c, all) ? "switched-off-slope" : byOrder(dates);
  if (c.status === "not-set") return "not-set";
  if (c.status === "no-key") return "no-key";
  if (c.status === "ambiguous") return "several-keys";
  if (c.status === "units-unknown") return "units-unknown";
  return null;
}

const CONTENT = new Set(["added", "modified"]);

/** A document's last content change (added, or a non-cosmetic edit) as YYYY-MM-DD, from its history entries; null when none. */
export function lastContentChange(entries: { date: string; changeType: string; changeKind?: string }[]): string | null {
  const days = entries.filter((e) => CONTENT.has(e.changeType) && e.changeKind !== "lint" && e.changeKind !== "typo").map((e) => e.date.slice(0, 10));
  return days.length ? days.sort().at(-1)! : null;
}
