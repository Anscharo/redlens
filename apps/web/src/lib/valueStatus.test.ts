// What a card's tooltip and the audit report say the contract holds: a slope
// is read as its own value, never replaced by "unlimited" because the
// maxAmount is (it is marked beside it instead), and never scaled by decimals
// guessed from an unlimited max.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit } from "@/lib/pau";
import { checkChainValue } from "@/lib/pauCheckValue";
import { fieldValue } from "./valueStatus";

const UNLIMITED = ((1n << 256n) - 1n).toString();
const USDS = { decimals: 18, symbol: "USDS", token: "0x" + "1".repeat(40), source: "token" as const };
const limit = (maxAmount: string, slope: string, unit?: LiveRateLimit["unit"]): LiveRateLimit =>
  ({ key: "0xk", configured: { maxAmount, slope }, setAt: { block: 1, time: "t", tx: "0x" }, changes: 1, data: { maxAmount, slope, lastAmount: "0", lastUpdated: "0" }, available: "0", ...(unit ? { unit } : {}) }) as LiveRateLimit;
const both = (r: LiveRateLimit, field: "maxAmount" | "slope") => [fieldValue(r, field), checkChainValue({ field, limit: r })];

describe("the contract's value beside an unlimited maxAmount", () => {
  it("reads the maxAmount as unlimited and the slope as its own value", () => {
    const r = limit(UNLIMITED, "0", USDS);
    expect(both(r, "maxAmount")).toEqual(["unlimited", "unlimited"]);
    expect(both(r, "slope")).toEqual(Array(2).fill("0 USDS per day (maxAmount unlimited)"));
  });
  it("scales a nonzero slope by its token, and leaves it raw where the token is not known", () => {
    const perDay = (10n ** 24n / 86_400n).toString();
    expect(both(limit(UNLIMITED, perDay, USDS), "slope")).toEqual(["1M USDS per day (maxAmount unlimited)", "1000000 USDS per day (maxAmount unlimited)"]);
    expect(both(limit(UNLIMITED, "5"), "slope")).toEqual(Array(2).fill("5 raw units per second, token not known (maxAmount unlimited)"));
    expect(both(limit(UNLIMITED, "0"), "slope")).toEqual(Array(2).fill("0 per day (maxAmount unlimited)"));
  });
  it("reads a bounded limit as before", () => {
    const r = limit((10n ** 26n).toString(), (10n ** 24n / 86_400n).toString(), USDS);
    expect(both(r, "maxAmount")).toEqual(["100M USDS", "100000000 USDS"]);
    expect(both(r, "slope")).toEqual(["1M USDS per day", "1000000 USDS per day"]);
    expect(fieldValue(limit("1000000000000", "0"), "slope")).toBe("0 per day");
  });
});
