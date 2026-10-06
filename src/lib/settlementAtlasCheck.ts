// The amount due from a Prime to Sky as the Atlas's Stage 1 Simplified
// Profit And Loss Calculation states it, from the workbook's venue rows,
// beside Soter's published figure. The Atlas computes it venue by venue:
// Instance Profit is the greater of revenue minus expense and zero
// (A.2.4.1.2.2.1.1.2.2.1, 9974c452), and the amount due is total revenue
// minus total profit (A.2.4.1.2.2.1.1.2.4, 2617edae). Soter charges each
// venue its full cost of funds instead, so a venue earning less than its
// cost of funds sends Sky more than its revenue. Assumptions, all stated
// on the page: a venue's workbook cost of funds stands for its Instance
// Expense (A.2.4.1.2.2.1.1.2.2.1.1, 6cbe7181), and the discretionary
// penalties (A.2.4.1.2.2.1.1.2.3) are zero — the workbooks carry none.
import type { SettlementReport, SettlementVenue } from "./settlements";

/** Spark realizes the full profit and loss on USDT in SparkLend and on
 *  pyUSD in SparkLend or its ALM Proxy (A.2.4.1.2.2.1.1.4.1, 34893b77;
 *  A.2.4.1.2.2.1.1.4.2, 8619f00f), so those venues take no floor. Matched
 *  on the workbook's venue label — fragile: a relabelled row would be
 *  floored like any other. */
function fullPnl(prime: string, v: SettlementVenue): boolean {
  if (prime !== "spark") return false;
  const l = v.label ?? v.id;
  return (/\bUSDT\b/i.test(l) && /SparkLend/i.test(l)) || (/\bPYUSD\b/i.test(l) && /SparkLend|ALM/i.test(l));
}

export interface AtlasAmountDue {
  /** Soter's published amount due (cost of funds + SDE). */
  soter: number;
  /** The Atlas formula over the same rows. */
  atlas: number;
  /** soter − atlas: what the zero floor would leave with the Prime. */
  gap: number;
}

export function atlasAmountDue(report: SettlementReport): AtlasAmountDue {
  let atlas = 0;
  for (const v of report.venues) {
    const sde = v.sdRevenue ?? 0;
    const cof = v.profitToSky - sde;
    const rev = v.revenueToPrime;
    // Sky Direct Exposure yield is Sky's outright (A.2.2.10.1.1.1.1.5).
    atlas += sde;
    // Synthetic rows (the spread refund) and the exceptions take no floor.
    atlas += v.synthetic || fullPnl(report.prime, v) ? cof : rev - Math.max(rev - cof, 0);
  }
  const soter = report.headline.skyRevenue;
  return { soter, atlas, gap: soter - atlas };
}
