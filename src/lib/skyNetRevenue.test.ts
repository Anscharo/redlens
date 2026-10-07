import { describe, expect, it } from "vitest";
import { skyIncomeExpense, type SkyTotalMonth } from "./skyNetRevenue";
import type { SettlementReport } from "./settlements";

describe("skyIncomeExpense", () => {
  const book = (prime: string, sky: number, par: number, cof: number) =>
    ({ prime, month: "2026-08", headline: { skyRevenue: sky, primeAgentRevenue: par, cof } }) as unknown as SettlementReport;
  const row = (primes: { prime: string; mint: number; send: number }[], netRevenue: number): SkyTotalMonth => ({
    month: "2026-08", basis: "accrual", mscNet: 0, nonMscNet: 0, netRevenue,
    legs: { primes, nonMscIncome: 16, nonMscExpense: -15 },
  });

  it("takes the kept supply share out of the mint, and keeps Soter's Net Revenue exactly", () => {
    // spark: To Sky 10, kept 3, so mint 13; keel mints nothing and has no workbook.
    const r = skyIncomeExpense(row([{ prime: "spark", mint: 13, send: -4 }, { prime: "keel", mint: 0, send: -1 }], 12), [book("spark", 10, 8, 5)]);
    expect(r).toEqual({ month: "2026-08", income: 26, expenses: 14, net: 12, corrections: 0 });
  });

  it("reports a mint above the workbook's To Sky as corrections, and never counts a negative kept share", () => {
    const r = skyIncomeExpense(row([{ prime: "spark", mint: 12, send: 0 }], 20), [book("spark", 10, 4, 5)]);
    expect(r?.corrections).toBe(2);
  });

  it("is null on a buffer month or for a Prime minting without a workbook", () => {
    expect(skyIncomeExpense({ ...row([], 1), basis: "buffer" }, [])).toBeNull();
    expect(skyIncomeExpense(row([{ prime: "obex", mint: 5, send: 0 }], 1), [])).toBeNull();
  });
});
