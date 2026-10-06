// Sky's Net Revenue by month, from Soter Labs' consolidated sky_total
// reports (settlements.json `skyTotal`, parsed by
// scripts/lib/settlement-sky-total.ts). The Atlas defines Net Revenue as
// Income minus Expenses (A.2.3.1.2.1.1), calculated per calendar month, with
// MSC income and expenses "recognized in the month covered by that cycle"
// (A.2.3.1.2.1). Only the accrual-basis reports book it that way. The
// earlier buffer-basis ones book each cycle in the month it executed, and
// part of the cycle (the Demand-side Buffer transfer) under the non-MSC leg,
// so they cannot be moved onto the Atlas's months cleanly; they are left
// out rather than drawn on the wrong basis.

/** One consolidated report, as published. */
export interface SkyTotalMonth {
  month: string;
  /** accrual: the MSC leg is the cycle EARNED in `month`. buffer: it is the
   *  cycle EXECUTED in `month`, i.e. the previous month's. */
  basis: "accrual" | "buffer";
  mscNet: number;
  nonMscNet: number;
  netRevenue: number;
}

/** Net Revenue by month, for the months reported on the Atlas's basis. */
export function netRevenueByMonth(rows: readonly SkyTotalMonth[] | undefined): Map<string, number> {
  return new Map((rows ?? []).filter((r) => r.basis === "accrual").map((r) => [r.month, r.netRevenue]));
}
