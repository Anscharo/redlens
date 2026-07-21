// Server-side text filter for the curated report tools. Applies a report
// tool's optional `filter` argument to its rows using the SAME field logic the
// matching report PAGE uses (the shared `*SearchFields` in src/lib), so a
// scoped chat query — "the rewards rows for Spark", or the filter already
// active on the page the user is viewing — returns only the matching rows
// instead of the entire report. That keeps the model's context small, which is
// the whole point of filtering server-side rather than dumping every row.
//
// Semantics mirror the page's header box exactly (broad AND-of-tokens by
// default; a fully quoted "..."/'...' selects phrase/strict), because both
// sides call parseReportQuery + rowMatches over identical SearchField[].
import { parseReportQuery, filterRows, type SearchField } from "../../lib/reportFilter.ts";

export function applyReportFilter<T>(
  rows: readonly T[],
  filter: string | undefined,
  fieldsOf: (row: T) => SearchField[],
): T[] {
  const rq = parseReportQuery(filter ?? "");
  return filterRows(rows, rq, fieldsOf) as T[];
}
