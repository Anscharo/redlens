import { ogSearchFields, type OGResponsibility } from "@/lib/govopsResponsibilities";
import type { Chain } from "@/lib/reportChains";
import { RoleCategoryTable, type RoleCategoryTableConfig } from "./RoleCategoryTable";
import { EMPTY_QUERY, type ReportQuery } from "@/lib/reportFilter";

// ogSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_govops_responsibilities MCP tool filters rows with the exact
// same field logic this table renders. Re-exported for existing importers.
export { ogSearchFields };

const govopsValue = (r: OGResponsibility) => r.govops ?? "—";

// Unlike the Facilitator report, the GovOps text column and the Prime column
// are NOT the same category set: op-duty/core-duty show Prime but not a
// GovOps text column (the holder is implied); active-data/process-step show
// both.
const OG_ROLE_TEXT_CATS = new Set<OGResponsibility["category"]>(["active-data", "process-step"]);
const OG_PRIME_CATS = new Set<OGResponsibility["category"]>(["op-duty", "core-duty", "active-data", "process-step"]);

const ogConfig: RoleCategoryTableConfig<OGResponsibility> = {
  roleColumnHeader: "GovOps",
  dutyRoleColWidthClass: "w-36",
  showRoleCol: (cat) => OG_ROLE_TEXT_CATS.has(cat as OGResponsibility["category"]),
  showPrimeCol: (cat) => OG_PRIME_CATS.has(cat as OGResponsibility["category"]),
  dutyRoleValue: govopsValue,
  assignmentRoleValue: govopsValue,
  // Same unified fallback the Facilitator table (and govopsRowsToCSV) uses:
  // collapsed duty rows carry `agents`, active-data/process-step rows carry a
  // single `agent`, and either shape resolves here. The old per-category
  // branch (`r.agents ?? []` for the duty categories) would silently drop a
  // Prime chip from any duty row that carried only `agent` — data-neutral on
  // today's derivation, but a trap the moment duty rows gain that field.
  primeAgents: (r) => r.agents ?? (r.agent ? [r.agent] : []),
  rowKeyRole: (r) => r.govops ?? "",
  searchFields: ogSearchFields,
};

export function OGCategoryTable({
  cat,
  label,
  rows,
  chains,
  rq = EMPTY_QUERY,
}: {
  cat: OGResponsibility["category"];
  label: string;
  rows: OGResponsibility[];
  chains: Map<string, Chain>;
  rq?: ReportQuery;
}) {
  return <RoleCategoryTable cat={cat} label={label} rows={rows} chains={chains} rq={rq} config={ogConfig} />;
}
