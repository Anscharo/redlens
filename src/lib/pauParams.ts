// How the atlas states a rate limit in an instance's params: which operation a
// param is about, and what a stated maxAmount or slope means as an amount.
// Shared by the server's key-to-document refs and the atlas-vs-chain check.
import { RATE_LIMIT_ID_RE } from "./atlasHashes.ts";

/** "Inflow Rate Limits / maxAmount" → side "Inflow", field "maxAmount". */
export const VALUE_PARAM_RE = /^(.*?)\s*Rate\s*Limits?\s*\/\s*(maxAmount|slope)\b/i;

const SIDE: Record<string, string> = { inflow: "in", deposit: "in", supply: "in", outflow: "out", withdraw: "out", withdrawal: "out", redeem: "out" };

/** The operation a param name is about ("Aggregate Deposit RateLimitID" and "Inflow Rate Limits" both "in"), or "" for none. */
export function paramSide(name: string): string {
  const words = name.replace(RATE_LIMIT_ID_RE, " ").replace(/Rate\s*Limits?\b|\(.*?\)|\//gi, " ").trim().split(/\s+/);
  const last = (words.at(-1) ?? "").toLowerCase();
  return SIDE[last] ?? last;
}

/**
 * A stated value: unlimited, an amount in whole token units (a decimal string,
 * "million" and "billion" applied), "none" for a value the atlas says is not
 * set yet or does not apply ("N/A - swaps only", "specified in a future
 * iteration"), or null for text this does not read.
 */
export type StatedValue = { kind: "unlimited" } | { kind: "amount"; units: string; symbol: string | null } | { kind: "none" };

const AMOUNT_RE = /^([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*([A-Za-z][\w/]*(?:\s+or\s+[A-Za-z][\w/]*)?)?\s*(?:per\s+day|\/\s*day)?$/i;
const SCALE: Record<string, number> = { million: 6, billion: 9 };

/** A decimal string times 10^shift, as a decimal string ("1.5", 6 → "1500000"). */
export function shiftDecimal(units: string, shift: number): string {
  const [whole, frac = ""] = units.split(".");
  const digits = (whole + frac.padEnd(shift, "0").slice(0, shift)).replace(/^0+(?=\d)/, "");
  const rest = frac.slice(shift);
  return rest.replace(/0+$/, "") ? `${digits}.${rest.replace(/0+$/, "")}` : digits;
}

export function parseStated(text: string): StatedValue | null {
  const t = text.trim().replace(/`/g, "");
  if (/^unlimited$|^type\(uint256\)\.max$/i.test(t)) return { kind: "unlimited" };
  if (/^n\/a\b|specified in a future/i.test(t)) return { kind: "none" };
  const m = AMOUNT_RE.exec(t);
  if (!m) return null;
  const units = shiftDecimal(m[1].replace(/,/g, ""), SCALE[m[2]?.toLowerCase() ?? ""] ?? 0);
  const symbol = m[3] && !/^(per|day)$/i.test(m[3]) ? m[3] : null;
  return { kind: "amount", units, symbol };
}
