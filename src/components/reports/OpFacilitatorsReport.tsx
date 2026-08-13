import { toAnchorId } from "../../lib/anchorId";
import { stripExecutorPrefix, type ActiveFilter, type Chain } from "../../lib/reportChains";
import { FAC_EDGES } from "../../lib/roleEdges";
import {
  CATEGORY_LABELS,
  type OFResponsibility,
  deriveFacilitatorResponsibilities,
  facilitatorRowsToCSV,
} from "../../lib/facilitatorResponsibilities";
import { OFCategoryTable, ofSearchFields } from "./OFCategoryTable";
import { RoleResponsibilityReport, type RoleReportConfig } from "./RoleResponsibilityReport";
import type { ReportMode } from "../../lib/reportFilter";

// Header-box text filter over the fields declared in OFCategoryTable (which
// also tracks their per-category visibility for the hidden-match aside).
// Category is pill-owned and deliberately excluded.
const SEARCHES = "doc no · title · duty text · role · facilitator · executor · prime agents";

const rowAgents = (r: OFResponsibility): string[] => r.agents ?? (r.agent ? [r.agent] : []);
const rowFacs = (r: OFResponsibility): string[] => r.facilitators ?? (r.facilitator ? [r.facilitator] : []);

// Holder name → executor slugs, straight from the fac edges. Duty/active-data/
// process-step rows carry a `facilitator` holder but no `executor` and (Core
// side) no prime chain — this lets the executor filter still match them.
function matches(
  r: OFResponsibility,
  filter: ActiveFilter,
  chains: Map<string, Chain>,
  holderExec: Map<string, Set<string>>,
): boolean {
  if (filter === null) return true;
  const agents = rowAgents(r);
  if (filter.kind === "agent") return agents.some((a) => toAnchorId(a) === filter.slug);
  if (filter.kind === "executor")
    return (
      (r.executor != null && toAnchorId(stripExecutorPrefix(r.executor)) === filter.slug) ||
      agents.some((a) => {
        const n = chains.get(a)?.executorName;
        return n != null && toAnchorId(n) === filter.slug;
      }) ||
      // Holder→executor fallback ONLY for rows with no executor/agent context
      // (Core-side duty/active-data/process-step rows have no prime, so the
      // chain walk above can't reach them). Gating on empty context stops a
      // shared Facilitator holder from leaking one executor's assignment row
      // into another executor's filter.
      (r.executor == null && agents.length === 0 && rowFacs(r).some((f) => holderExec.get(f)?.has(filter.slug) === true))
    );
  // facilitator
  return (
    rowFacs(r).some((f) => toAnchorId(f) === filter.slug) ||
    agents.some((a) => {
      const n = chains.get(a)?.facilitatorName;
      return !!n && toAnchorId(n) === filter.slug;
    })
  );
}

const facilitatorConfig: RoleReportConfig<OFResponsibility> = {
  reportId: "of-responsibilities",
  documentTitle: "Operational Facilitator Responsibilities: Sky Atlas by Redline",
  heading: "Operational Facilitator Responsibilities",
  introText: "Every Atlas section mandating action from a Facilitator.",
  introDocUuid: "1ce24b08-84ff-4524-9710-49bba429c6ef",
  introLinkSuffix: "Facilitators",
  searches: SEARCHES,
  filename: "op-facilitator-responsibilities.csv",
  pillLabel: "Facilitator",
  pillKind: "facilitator",
  edges: FAC_EDGES,
  categoryLabels: CATEGORY_LABELS,
  loadResponsibilities: deriveFacilitatorResponsibilities,
  rowsToCSV: facilitatorRowsToCSV,
  searchFields: ofSearchFields,
  matches,
  CategoryTable: OFCategoryTable,
};

export function OFReport({ query, mode }: { query: string; mode: ReportMode }) {
  return <RoleResponsibilityReport query={query} mode={mode} config={facilitatorConfig} />;
}
