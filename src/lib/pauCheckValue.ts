// What the contract holds for a checked atlas value (pauAtlasValues.ts), exact,
// in its token's units: a maxAmount as an amount, a slope as an amount per day
// rounded to whole units (the chain stores it per second, truncated). A slope is
// its own value even beside an unlimited maxAmount.
import type { ValueCheck } from "./pauAtlasValues.ts";
import { exactAmount, limitDecimals, slopeText, wholeAmount } from "./pauView.ts";

/** The contract's value for the check, "not set" when no live read holds it. */
export function checkChainValue(c: Pick<ValueCheck, "field" | "limit">): string {
  if (!c.limit?.data) return "not set";
  const { data, unit } = c.limit;
  if (c.field === "maxAmount") {
    const amount = exactAmount(data.maxAmount, limitDecimals(unit, data.maxAmount));
    return amount === "unlimited" ? amount : `${amount}${unit?.symbol ? ` ${unit.symbol}` : ""}`;
  }
  return slopeText(data.slope, data.maxAmount, unit, (raw, dec) => wholeAmount((BigInt(raw) * 86_400n).toString(), dec));
}
