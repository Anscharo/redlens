// The one mark an instance-card row shows, whatever it checks: a stated
// maxAmount or slope against the contract (paramChecks.ts), or a RateLimitID
// or address against the stored PAU snapshots (src/lib/pauAddressChecks.ts).
// Each producer turns its check into the same shape, so the card draws one
// column and one tooltip for both.
import type { LiveRateLimit, SetAt } from "@/lib/pau";
import { addressCheckId, type AddressCheck } from "@/lib/pauAddressChecks";
import type { PlainCheck } from "@/lib/agentChecks";
import type { InstanceParam } from "@/lib/radarRules";
import { addressRowMark } from "./addressMarks";
import { checksForParam, unstatedValueMark, valueRowMark, type ParamChecks, type ParamMark } from "./paramChecks";

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
  /** Agent Creation, Agent Token and guard-value rows, said in full (src/lib/agentChecks.ts, paramGuardChecks.ts). */
  plain: ReadonlyMap<string, PlainCheck>;
  /** Every key the prime's PAUs hold, by `${chain}|${key}` (heldKeyId), for a value the atlas leaves unstated. */
  held: ReadonlyMap<string, LiveRateLimit[]>;
}

export const heldKeyId = (chain: string, key: string) => `${chain}|${key.toLowerCase()}`;

/** A row's mark: its value checks where it states a maxAmount or slope, else its ID or address check, else its agent check; null when nothing checks it. */
export function rowMarkFor(marks: CardMarks, instanceDocId: string | null, p: InstanceParam): RowMark | null {
  const checks = checksForParam(marks.values, instanceDocId, p);
  if (checks.length) return unstatedValueMark(checks, marks.held) ?? valueRowMark(checks);
  const id = instanceDocId ? addressCheckId(instanceDocId, p.key) : null;
  const check = id ? marks.addresses.get(id) : undefined;
  if (check) return addressRowMark(check, p.srcDocId ?? instanceDocId);
  const plain = id ? marks.plain.get(id) : undefined;
  return plain ? { mark: plain.status, head: plain.head, lines: plain.lines, docId: p.srcDocId ?? instanceDocId } : null;
}

/** "0xdc03…384f". */
export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** A reason as the first words of a line. */
export const sentence = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;
