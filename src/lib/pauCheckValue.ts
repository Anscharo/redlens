// What the contract holds for a checked atlas value (pauAtlasValues.ts), exact,
// in its token's units: a maxAmount as an amount, a slope as an amount per day
// rounded to whole units (the chain stores it per second, truncated).
import type { ValueCheck } from "./pauAtlasValues.ts";
import { exactAmount, limitDecimals, wholeAmount } from "./pauView.ts";

/** The contract's value for the check, "not set" when no live read holds it. */
export function checkChainValue(c: Pick<ValueCheck, "field" | "limit">): string {
  if (!c.limit?.data) return "not set";
  const { data, unit } = c.limit;
  const dec = limitDecimals(unit, data.maxAmount);
  const symbol = unit?.symbol ? ` ${unit.symbol}` : "";
  if (exactAmount(data.maxAmount, dec) === "unlimited") return "unlimited";
  return c.field === "maxAmount" ? `${exactAmount(data.maxAmount, dec)}${symbol}` : `${wholeAmount((BigInt(data.slope) * 86_400n).toString(), dec)}${symbol} per day`;
}
