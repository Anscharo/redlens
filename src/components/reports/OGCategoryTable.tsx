import { ogSearchFields, type OGResponsibility } from "../../lib/govopsResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { RoleCategoryTable, type RoleCategoryTableConfig } from "./RoleCategoryTable";
import { EMPTY_QUERY, type ReportQuery } from "../../lib/reportFilter";

// ogSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_govops_responsibilities MCP tool filters rows with the exact
// same field logic this table renders. Re-exported for existing importers.
export { ogSearchFields };

const govopsValue = (r: OGResponsibility) => r.govops ?? "—";

// Unlike the Facilitator report, the GovOps text column and the Prime column
// are NOT the same category set: op-duty/core-duty show Prime but not a
// GovOps text column (the holder is implied); active-data/process-step show
// both, each reading a different agent source (see primeAgents below).
const OG_ROLE_TEXT_CATS = new Set<OGResponsibility["category"]>(["active-data", "process-step"]);
const OG_PRIME_CATS = new Set<OGResponsibility["category"]>(["op-duty", "core-duty", "active-data", "process-step"]);
const OG_SINGLE_AGENT_CATS = new Set<OGResponsibility["category"]>(["active-data", "process-step"]);

const ogConfig: RoleCategoryTableConfig<OGResponsibility> = {
  roleColumnHeader: "GovOps",
  dutyRoleColWidthClass: "w-36",
  showRoleCol: (cat) => OG_ROLE_TEXT_CATS.has(cat as OGResponsibility["category"]),
  showPrimeCol: (cat) => OG_PRIME_CATS.has(cat as OGResponsibility["category"]),
  dutyRoleValue: govopsValue,
  assignmentRoleValue: govopsValue,
  primeAgents: (r, cat) =>
    OG_SINGLE_AGENT_CATS.has(cat as OGResponsibility["category"]) ? (r.agent ? [r.agent] : []) : (r.agents ?? []),
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
