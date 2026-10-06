import { describe, expect, it } from "vitest";
import { netRevenueByMonth } from "./skyNetRevenue";

describe("netRevenueByMonth", () => {
  it("keeps only the months reported on the Atlas's basis", () => {
    const m = netRevenueByMonth([
      { month: "2026-06", basis: "buffer", mscNet: 1, nonMscNet: 2, netRevenue: 3 },
      { month: "2026-07", basis: "accrual", mscNet: 10, nonMscNet: -2, netRevenue: 8 },
    ]);
    expect([...m]).toEqual([["2026-07", 8]]);
    expect(netRevenueByMonth(undefined).size).toBe(0);
  });
});
