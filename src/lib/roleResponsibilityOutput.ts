// CSV and search-field shapes shared by the role-responsibility reports
// (Facilitator, GovOps). The rows come from ./roleResponsibilityRows.

import { toCSV } from "./csv";
import { atlasUrl } from "./routes";
import { expandSources, mergedDocNos } from "./dutyCollapse";
import type { SearchField } from "./reportFilter";
import type { RoleRowBase } from "./roleResponsibilityRows";

const agentCell = (r: RoleRowBase): string => (r.agents ?? (r.agent ? [r.agent] : [])).join("; ");

/** RFC-4180 CSV of already-filtered rows. Columns mirror the grouped table,
 *  flattened — except a collapsed duty row (one row covering several per-agent
 *  doc replicas) is re-expanded to one CSV row per doc, so every row's UUID /
 *  Atlas Link points at exactly one doc. `holderCell` renders the report's
 *  holder column, headed `holderHeader`. */
export function roleRowsToCSV<R extends RoleRowBase>(
  rows: readonly R[],
  labels: Record<string, string>,
  holderHeader: string,
  holderCell: (r: R) => string,
): string {
  return toCSV(
    ["Doc No", "Title", "UUID", "Atlas Link", "Category", "Duty", "Agents", holderHeader, "Executor", "Role"],
    rows.flatMap(expandSources).map((r) => [
      r.docNo,
      r.title,
      r.uuid,
      atlasUrl(r.uuid),
      labels[r.category] ?? r.category,
      r.duty,
      agentCell(r),
      holderCell(r),
      r.executor ?? "",
      r.role ?? "",
    ]),
  );
}

/** The search haystack for one row as labelled fields, shared by the report
 *  page (which also explains hidden-only matches) and the MCP tool (server-side
 *  filtering). `hidden` / `despace` drive UI match-explanation and de-spaced
 *  entity matching; row filtering (reportFilter.rowMatches) reads the values
 *  regardless of `hidden`. Only the holder field and the two visibility flags
 *  differ per report. */
export function roleSearchFields(
  r: RoleRowBase,
  holder: { label: string; value: string; hidden: boolean },
  primeVisible: boolean,
): SearchField[] {
  const assignment = r.category === "assignment";
  return [
    { label: "doc no", value: mergedDocNos(r, " ") },
    { label: "title", value: r.title, hidden: assignment },
    { label: "duty", value: r.duty, hidden: assignment },
    { label: "role", value: r.role ?? "", hidden: true },
    { label: holder.label, value: holder.value, hidden: holder.hidden, despace: true },
    { label: "executor", value: r.executor ?? "", hidden: !assignment, despace: true },
    { label: "prime agent", value: [r.agent, ...(r.agents ?? [])].filter(Boolean).join(", "), hidden: !primeVisible, despace: true },
  ];
}
