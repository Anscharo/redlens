// Soter Labs' consolidated monthly report: reports/sky_total/<YYYY-MM>/summary.md
// in soterlabs/settlement-reports. It is markdown, not a workbook, and it is
// the only source for Sky's whole month — the MSC leg plus non-MSC income
// and expense — so its Sky Net Revenue can be drawn beside the per-Prime
// workbooks. Fail loud like the xlsx parser: a renamed row must throw, not
// parse as 0.
import fs from "node:fs";
import path from "node:path";

import type { SkyTotalLegs, SkyTotalMonth } from "../../src/lib/skyNetRevenue.ts";

const num = (s: string) => Number(s.replace(/[*,\s]/g, ""));
const cellsOf = (line: string) => line.split("|").map((c) => c.trim()).filter(Boolean);

/** The amount on a bold table row whose first cell starts with `label`. */
function boldRow(md: string, label: RegExp): number {
  for (const line of md.split("\n")) {
    const cells = cellsOf(line);
    if (cells.length < 2 || !label.test(cells[0].replace(/\*/g, ""))) continue;
    const last = cells[cells.length - 1];
    if (/^\*\*-?[\d,.]+\*\*$/.test(last)) return num(last);
  }
  throw new Error(`sky_total summary.md has no bold row matching ${label}`);
}

/** The amount on a plain (non-bold) row whose first cell is exactly `label`. */
function plainRow(md: string, label: string): number {
  for (const line of md.split("\n")) {
    const cells = cellsOf(line);
    if (cells.length === 2 && cells[0] === label && /^-?[\d,.]+$/.test(cells[1])) return num(cells[1]);
  }
  throw new Error(`sky_total summary.md has no row "${label}"`);
}

/** The per-Prime rows of the accrual MSC leg: from the "MSC debt (mint)"
 *  header to the first bold row. */
function primeRows(md: string): SkyTotalLegs["primes"] {
  const lines = md.split("\n");
  const head = lines.findIndex((l) => /\|\s*Prime\s*\|\s*MSC debt \(mint\)\s*\|\s*Send to prime\s*\|/.test(l));
  if (head < 0) throw new Error("sky_total summary.md has no MSC debt (mint) table");
  const rows: SkyTotalLegs["primes"] = [];
  for (const line of lines.slice(head + 2)) {
    const cells = cellsOf(line);
    if (cells.length !== 3 || cells[0].startsWith("**")) break;
    if (!/^-?[\d,.]+$/.test(cells[1]) || !/^-?[\d,.]+$/.test(cells[2])) throw new Error(`sky_total summary.md: unreadable MSC row "${line}"`);
    rows.push({ prime: cells[0], mint: num(cells[1]), send: num(cells[2]) });
  }
  if (!rows.length) throw new Error("sky_total summary.md has an empty MSC debt (mint) table");
  return rows;
}

export function parseSkyTotalSummary(md: string): Omit<SkyTotalMonth, "month"> {
  const basis: SkyTotalMonth["basis"] | null = /ACCRUAL basis/.test(md) ? "accrual" : /buffer basis/i.test(md) ? "buffer" : null;
  if (!basis) throw new Error("sky_total summary.md names neither an ACCRUAL nor a buffer basis");
  const nets = {
    mscNet: boldRow(md, /^MSC net \(/),
    nonMscNet: boldRow(md, /^non-MSC net$/),
    netRevenue: boldRow(md, /^Sky Net Revenue$/),
  };
  if (basis !== "accrual") return { basis, ...nets };
  const legs: SkyTotalLegs = {
    primes: primeRows(md),
    nonMscIncome: plainRow(md, "non-MSC income"),
    nonMscExpense: plainRow(md, "non-MSC expense"),
  };
  return { basis, ...nets, legs };
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
