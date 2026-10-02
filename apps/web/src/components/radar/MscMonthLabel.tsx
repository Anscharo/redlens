import { formatMonth } from "../../lib/settlements";

/** Past this many columns a chart labels its months by name only and puts
 *  the year on a row of its own, under the first column and each January. */
export const YEAR_ROW_FROM = 7;

/** The two label rows of a month column: a chart with fewer columns than
 *  YEAR_ROW_FROM writes "Jan 2026" on one row; a longer one writes "Jan"
 *  and a year row beneath — the year itself where it starts, otherwise a
 *  blank keeping every column the same height. */
export function monthLabelRows(months: readonly string[], i: number): { month: string; year?: string } {
  const full = formatMonth(months[i]);
  if (months.length < YEAR_ROW_FROM) return { month: full };
  const year = months[i].slice(0, 4);
  const starts = i === 0 || months[i].endsWith("-01");
  return { month: full.slice(0, 3), year: starts ? year : "" };
}

/** A month column's label: the month, with the year beneath when the
 *  chart runs long enough to need a year row. */
export function MscMonthLabel({ months, index }: { months: readonly string[]; index: number }) {
  const rows = monthLabelRows(months, index);
  return (
    <span className="mono text-[10px] text-center leading-tight">
      {rows.month}
      {rows.year !== undefined && (
        <>
          <br />
          <span style={{ color: "var(--tan-3)" }}>{rows.year || " "}</span>
        </>
      )}
    </span>
  );
}
