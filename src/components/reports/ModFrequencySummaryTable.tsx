import { memo } from "react";
import type { ModFrequencySummaryRow } from "@/lib/modFrequencyIndex";

// Per-category rollup: how many docs in each section/type match the active
// filter (matchLabel names it, e.g. "≤1 modification"), against that
// category's full size — not just the doc-level table's filtered subset.
const SummaryRow = memo(function SummaryRow({ row }: { row: ModFrequencySummaryRow }) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-1.5 px-3 align-top text-sm text-tan">{row.label}</td>
      <td className="py-1.5 px-3 align-top text-sm mono text-tan text-right">{row.matchCount}</td>
      <td className="py-1.5 px-3 align-top text-sm mono text-tan-2 text-right">{row.total}</td>
      <td className="py-1.5 px-3 align-top text-sm mono text-tan text-right">
        {row.matchPercent.toFixed(1)}%
      </td>
    </tr>
  );
});

export const ModFrequencySummaryTable = memo(function ModFrequencySummaryTable({
  summary,
  matchLabel,
}: {
  summary: readonly ModFrequencySummaryRow[];
  /** Names what "matches" means for the current filter, e.g. "≤1 modification". */
  matchLabel: string;
}) {
  return (
    <table className="w-full text-left mb-8">
      <thead>
        <tr className="text-xs mono text-tan-3">
          <th className="py-1 px-3 font-normal">Category</th>
          <th className="py-1 px-3 font-normal w-28 text-right">{matchLabel}</th>
          <th className="py-1 px-3 font-normal w-20 text-right">Total</th>
          <th className="py-1 px-3 font-normal w-20 text-right">% {matchLabel}</th>
        </tr>
      </thead>
      <tbody>
        {summary.map((row) => (
          <SummaryRow key={row.key} row={row} />
        ))}
      </tbody>
    </table>
  );
});
