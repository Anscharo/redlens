// Soter Labs' consolidated monthly report: reports/sky_total/<YYYY-MM>/summary.md
// in soterlabs/settlement-reports. It is markdown, not a workbook, and it is
// the only source for Sky's whole month — the MSC leg plus non-MSC income
// and expense — so its Sky Net Revenue can be drawn beside the per-Prime
// workbooks. Fail loud like the xlsx parser: a renamed row must throw, not
// parse as 0.
import fs from "node:fs";
import path from "node:path";

import type { SkyTotalMonth } from "../../src/lib/skyNetRevenue.ts";

const num = (s: string) => Number(s.replace(/[*,\s]/g, ""));

/** The amount on a bold table row whose first cell starts with `label`. */
function boldRow(md: string, label: RegExp): number {
  for (const line of md.split("\n")) {
    const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2 || !label.test(cells[0].replace(/\*/g, ""))) continue;
    const last = cells[cells.length - 1];
    if (/^\*\*-?[\d,.]+\*\*$/.test(last)) return num(last);
  }
  throw new Error(`sky_total summary.md has no bold row matching ${label}`);
}

export function parseSkyTotalSummary(md: string): Omit<SkyTotalMonth, "month"> {
  const basis: SkyTotalMonth["basis"] | null = /ACCRUAL basis/.test(md) ? "accrual" : /buffer basis/i.test(md) ? "buffer" : null;
  if (!basis) throw new Error("sky_total summary.md names neither an ACCRUAL nor a buffer basis");
  return {
    basis,
    mscNet: boldRow(md, /^MSC net \(/),
    nonMscNet: boldRow(md, /^non-MSC net$/),
    netRevenue: boldRow(md, /^Sky Net Revenue$/),
  };
}

/** Every reports/sky_total/<YYYY-MM>/summary.md under `reportsDir`, by month.
 *  No sky_total directory is an empty list, not an error: a single-workbook
 *  parse has none. */
export function parseSkyTotalDir(reportsDir: string): SkyTotalMonth[] {
  const dir = path.join(reportsDir, "sky_total");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((m) => /^\d{4}-\d{2}$/.test(m) && fs.existsSync(path.join(dir, m, "summary.md")))
    .sort()
    .map((month) => ({ month, ...parseSkyTotalSummary(fs.readFileSync(path.join(dir, month, "summary.md"), "utf8")) }));
}
