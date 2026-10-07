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

import { supplyKept, type SettlementReport } from "./settlements";

/** The accrual report's two legs, line by line. */
export interface SkyTotalLegs {
  /** Per Prime: what the Prime mints to Sky's buffer and what Sky sends it. */
  primes: { prime: string; mint: number; send: number }[];
  nonMscIncome: number;
  /** Negative, as published. */
  nonMscExpense: number;
}

/** One consolidated report, as published. */
export interface SkyTotalMonth {
  month: string;
  /** accrual: the MSC leg is the cycle EARNED in `month`. buffer: it is the
   *  cycle EXECUTED in `month`, i.e. the previous month's. */
  basis: "accrual" | "buffer";
  mscNet: number;
  nonMscNet: number;
  netRevenue: number;
  /** Accrual reports only. */
  legs?: SkyTotalLegs;
}

export interface SkyIncomeExpense {
  month: string;
  income: number;
  /** Positive: the amount Sky spent. */
  expenses: number;
  /** Soter's Sky Net Revenue, unchanged: income − expenses. */
  net: number;
  /** MSC income minus the month's workbook To Sky: prior-cycle corrections
   *  riding the same settlement. 0 when the settlement carries none. */
  corrections: number;
}

/** Sky's Income (A.2.3.1.2.1.2), Expenses (A.2.3.1.2.1.3) and Net Revenue
 *  (A.2.3.1.2.1.1) for one accrual month. A Prime's mint is Sky's share plus
 *  the supply side the Prime keeps (Soter's sky_total_accrual: mint = sky +
 *  sky_adj + max(sv, 0)), so Sky's MSC income is mint minus that kept share,
 *  read from the Prime's workbook; MSC expense is whatever separates that
 *  income from MSC net. Null for a buffer-basis month, or when a Prime mints
 *  without a workbook to take its kept share from. */
export function skyIncomeExpense(row: SkyTotalMonth, reports: readonly SettlementReport[]): SkyIncomeExpense | null {
  if (row.basis !== "accrual" || !row.legs) return null;
  const books = new Map(reports.filter((r) => r.month === row.month).map((r) => [r.prime, r]));
  let mscIncome = 0;
  for (const p of row.legs.primes) {
    const book = books.get(p.prime);
    if (!book && p.mint !== 0) return null;
    const kept = book ? Math.max(0, supplyKept(book)) : 0;
    mscIncome += p.mint - kept;
  }
  const toSky = [...books.values()].reduce((n, r) => n + r.headline.skyRevenue, 0);
  const income = mscIncome + row.legs.nonMscIncome;
  return { month: row.month, income, expenses: income - row.netRevenue, net: row.netRevenue, corrections: mscIncome - toSky };
}

/** Income, Expenses and Net for every month that supports them, by month. */
export function skyIncomeExpenseByMonth(rows: readonly SkyTotalMonth[] | undefined, reports: readonly SettlementReport[]): SkyIncomeExpense[] {
  return (rows ?? []).map((r) => skyIncomeExpense(r, reports)).filter((r): r is SkyIncomeExpense => r !== null);
}
