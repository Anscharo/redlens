// How a rate-limit value check reads to a person: one glyph and one phrase per
// status, and the contract's own value in its token's units. The reader's
// "Atlas vs contract" panel and the Radar instance cards both say it this way,
// so a mark means the same thing wherever it appears.
import type { ValueCheck, ValueStatus } from "@/lib/pauAtlasValues";
import type { LiveRateLimit } from "@/lib/pau";
import { NOT_INDEXED } from "@/lib/plainCheck";
import { formatAmount, formatPerDay, limitDecimals, slopeText } from "./pau";

export const VALUE_STATUS: Record<ValueStatus, { mark: string; text: string }> = {
  match: { mark: "✓", text: "matches the atlas" },
  mismatch: { mark: "✗", text: "differs from the atlas" },
  "units-unknown": { mark: "?", text: "token units not confirmed" },
  ambiguous: { mark: "?", text: "more than one key could be this one" },
  "not-set": { mark: "!", text: "not set on the contract" },
  unread: { mark: "…", text: "contract not read yet" },
  "no-deployment": { mark: "–", text: NOT_INDEXED },
  "unknown-chain": { mark: "–", text: "chain not recognised" },
  "no-key": { mark: "–", text: "no rate-limit key found" },
  "not-stated": { mark: "–", text: "the atlas sets no value yet" },
  unparsed: { mark: "?", text: "atlas value not read" },
};

/** A check the contract was certainly compared on: its `limit.data` is read. */
export const isCompared = (c: ValueCheck) => c.status === "match" || c.status === "mismatch";

/**
 * A held key's maxAmount or slope in its token's units, from its live read, else
 * the last value its history set. A slope is always its own value, even beside
 * an unlimited maxAmount.
 */
export function fieldValue(r: LiveRateLimit, field: ValueCheck["field"]): string {
  const { maxAmount, slope } = r.data ?? r.configured;
  if (field === "maxAmount") {
    const symbol = r.unit?.symbol ? ` ${r.unit.symbol}` : "";
    const amount = formatAmount(maxAmount, limitDecimals(r.unit, maxAmount));
    return amount === "unlimited" ? amount : `${amount}${symbol}`;
  }
  return slopeText(slope, maxAmount, r.unit, formatPerDay);
}

/** What the contract holds for the value, in its token's units; call only for a compared check. */
export const contractValue = (c: ValueCheck): string => fieldValue(c.limit!, c.field);

/** A held key's live limit in its token's units: "200M spUSDS · 400M spUSDS/day", or why it has none. */
export function limitSummary(r: LiveRateLimit): string {
  if (!r.data) return "not read";
  const dec = limitDecimals(r.unit, r.data.maxAmount);
  const symbol = r.unit?.symbol ? ` ${r.unit.symbol}` : "";
  const max = formatAmount(r.data.maxAmount, dec);
  if (max === "unlimited") return "unlimited";
  return `${max}${symbol} · ${formatPerDay(r.data.slope, dec)}${symbol}/day`;
}
