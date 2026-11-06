// The one mark an instance-card row shows, whatever it checks: a stated
// maxAmount or slope against the contract (paramChecks.ts), or a RateLimitID
// or address against the stored PAU snapshots (src/lib/pauAddressChecks.ts).
// Each producer turns its check into the same shape, so the card draws one
// column and one tooltip for both.
import type { SetAt } from "@/lib/pau";
import { addressCheckId, type AddressCheck } from "@/lib/pauAddressChecks";
import type { InstanceParam } from "@/lib/radarRules";
import { addressRowMark } from "./addressMarks";
import { checksForParam, valueRowMark, type ParamChecks, type ParamMark } from "./paramChecks";

/** One tooltip line: a labelled value, a sentence, or when the value was set (linked to its tx) and read. */
export type TipLine = { label: string; value: string } | { text: string } | { set: SetAt; chain: string; readAt: string | null };

export interface RowMark {
  mark: ParamMark;
  head: string;
  lines: TipLine[];
  /** The document whose Onchain tab the mark opens. */
  docId: string | null;
}

/** A prime's checks, as its instance cards look them up. */
export interface CardMarks {
  values: ParamChecks;
  addresses: ReadonlyMap<string, AddressCheck>;
}

/** A row's mark: its value checks where it states a maxAmount or slope, else its ID or address check; null when nothing checks it. */
export function rowMarkFor(marks: CardMarks, instanceDocId: string | null, p: InstanceParam): RowMark | null {
  const checks = checksForParam(marks.values, instanceDocId, p);
  if (checks.length) return valueRowMark(checks);
  const check = instanceDocId ? marks.addresses.get(addressCheckId(instanceDocId, p.key)) : undefined;
  return check ? addressRowMark(check, p.srcDocId ?? instanceDocId) : null;
}

/** "0xdc03…384f". */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A reason as the first words of a line. */
export const sentence = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
