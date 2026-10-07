import { describe, expect, it } from "vitest";
import { parseSkyTotalSummary } from "../scripts/lib/settlement-sky-total";

const accrual = `# SKY_TOTAL — 2026-09

Consolidated Sky Net Revenue, ACCRUAL basis (operator definition): prime revenue EARNED in 2026-09.

| Prime | MSC debt (mint) | Send to prime |
|---|---:|---:|
| spark | 11,627,438.00 | -4,218,121.00 |
| skybase | 0.00 | -143,812.00 |
| **subtotal before historical catch-ups** | **11,627,438.00** | **-4,361,933.00** |
| skybase: previously unbooked demand-side true-ups | | -177,113.78 |
| **MSC net (accrual)** | | **13,927,348.22** |

| Line | USDS |
|---|---:|
| non-MSC income | 14,938,630.49 |
| non-MSC expense | -14,230,031.28 |
| **non-MSC net** | **708,599.21** |

| Field | USDS |
|---|---:|
| MSC net (accrual) | 13,927,348.22 |
| **Sky Net Revenue** | **14,635,947.43** |
`;

describe("parseSkyTotalSummary", () => {
  it("reads the basis and the three bold totals", () => {
    expect(parseSkyTotalSummary(accrual)).toEqual({
      basis: "accrual", mscNet: 13927348.22, nonMscNet: 708599.21, netRevenue: 14635947.43,
      legs: {
        primes: [{ prime: "spark", mint: 11627438, send: -4218121 }, { prime: "skybase", mint: 0, send: -143812 }],
        nonMscIncome: 14938630.49,
        nonMscExpense: -14230031.28,
      },
    });
  });

  it("reads a buffer-basis report and a negative non-MSC leg", () => {
    const md = accrual.replace("ACCRUAL basis", "buffer basis").replace("**708,599.21**", "**-972,786.88**").replace("MSC net (accrual)** |", "MSC net (buffer basis)** |");
    expect(parseSkyTotalSummary(md)).toMatchObject({ basis: "buffer", nonMscNet: -972786.88 });
  });

  it("throws on a missing row or an unknown basis rather than reading 0", () => {
    expect(() => parseSkyTotalSummary(accrual.replace("**Sky Net Revenue**", "**Net**"))).toThrow(/Sky Net Revenue/);
    expect(() => parseSkyTotalSummary(accrual.replace("ACCRUAL basis", "cash basis"))).toThrow(/basis/);
    expect(() => parseSkyTotalSummary(accrual.replace("| non-MSC income |", "| income |"))).toThrow(/non-MSC income/);
    expect(() => parseSkyTotalSummary(accrual.replace("MSC debt (mint)", "Debt"))).toThrow(/MSC debt/);
  });
});
