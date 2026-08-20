import { ofSearchFields, type OFResponsibility } from "@/lib/facilitatorResponsibilities";
import type { Chain } from "../../lib/reportChains";
import { RoleCategoryTable, type RoleCategoryTableConfig } from "./RoleCategoryTable";
import { EMPTY_QUERY, type ReportQuery } from "@/lib/reportFilter";

// ofSearchFields (the row search haystack) lives in the lib module so the
// atlas_report_facilitator_responsibilities MCP tool filters rows with the
// exact same field logic this table renders. Re-exported for existing importers.
export { ofSearchFields };

// Duty rows carry per-row facilitator attribution (fan-out edges) — shown for
// op-duty, where two orgs hold the role and the split is real information.
// Universal rows bind every holder, so the column would be constant noise.
const facNames = (r: OFResponsibility) => r.facilitators?.join(", ") ?? r.facilitator ?? "—";

// showFac and showPrime happen to be the same category set for this report:
// only op-duty/active-data/process-step render the duty layout's Facilitator
// + Prime columns; universal/core-facilitator show neither.
const OF_DUTY_ROLE_CATS = new Set<OFResponsibility["category"]>(["op-duty", "active-data", "process-step"]);

const ofConfig: RoleCategoryTableConfig<OFResponsibility> = {
  roleColumnHeader: "Facilitator",
  dutyRoleColWidthClass: "w-40",
  showRoleCol: (cat) => OF_DUTY_ROLE_CATS.has(cat as OFResponsibility["category"]),
  showPrimeCol: (cat) => OF_DUTY_ROLE_CATS.has(cat as OFResponsibility["category"]),
  dutyRoleValue: facNames,
  assignmentRoleValue: (r) => r.facilitator ?? "—",
  primeAgents: (r) => r.agents ?? (r.agent ? [r.agent] : []),
  rowKeyRole: (r) => r.facilitator ?? "",
  searchFields: ofSearchFields,
};

export function OFCategoryTable({
  cat,
  label,
  rows,
  chains,
  rq = EMPTY_QUERY,
}: {
  cat: OFResponsibility["category"];
  label: string;
  rows: OFResponsibility[];
  chains: Map<string, Chain>;
  rq?: ReportQuery;
}) {
  return <RoleCategoryTable cat={cat} label={label} rows={rows} chains={chains} rq={rq} config={ofConfig} />;
}
