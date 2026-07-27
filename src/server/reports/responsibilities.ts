// Shared envelope for the two responsibility reports (facilitator + govops).
// Both derivations emit the same row shape — a `category` discriminant plus an
// optional `sources` provenance array — and want the identical rollup: drop
// provenance when asked, tally per category in the labels' canonical order, then
// budget-fit and wrap. Keeping it here means a change to the shaping can't land
// in one report and silently miss the other (the same rationale dutyCollapse.ts
// gives for the two derivations sharing collapse logic).
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import type { ToolResult } from "../chat/tools/tools.ts";

interface ResponsibilityRow {
  category: string;
  sources?: unknown;
}

export function buildResponsibilitiesReport(
  report: string,
  rows: ResponsibilityRow[],
  labels: Record<string, string>,
  includeProvenance: boolean,
): ToolResult {
  // provenance = the multi-doc `sources` array on collapsed duty rows; docNo/uuid
  // are identity, always kept.
  const shaped = includeProvenance ? rows : rows.map(({ sources: _sources, ...rest }) => rest);

  // Single pass over rows; emit counts in the labels' canonical order so the
  // model sees the shape (and empty categories are skipped) without a scan per
  // category.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
  const categories: Record<string, number> = {};
  for (const cat of Object.keys(labels)) {
    const n = counts.get(cat);
    if (n) categories[labels[cat]] = n;
  }

  const { kept, truncated } = fitToBudget(shaped);
  const result: ToolResult = {
    report,
    total: rows.length,
    returned: kept.length,
    truncated,
    categories,
    responsibilities: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
