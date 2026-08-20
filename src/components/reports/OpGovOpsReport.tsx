import { toAnchorId } from "@/lib/anchorId";
import { stripExecutorPrefix, type ActiveFilter, type Chain } from "@/lib/reportChains";
import { GOV_EDGES } from "@/lib/roleEdges";
import {
  CATEGORY_LABELS,
  type OGResponsibility,
  deriveGovOpsResponsibilities,
  govopsRowsToCSV,
} from "@/lib/govopsResponsibilities";
import { OGCategoryTable, ogSearchFields } from "./OGCategoryTable";
import { RoleResponsibilityReport, type RoleReportConfig } from "./RoleResponsibilityReport";
import type { ReportMode } from "@/lib/reportFilter";

// Header-box text filter over the fields declared in OGCategoryTable (which
// also tracks their per-category visibility for the hidden-match aside).
// Category is pill-owned and deliberately excluded.
const SEARCHES = "doc no · title · duty text · role · govops · executor · prime agents";

// Which primes does a row cover? assignment/duty rows carry `agents`;
// active-data rows carry a single `agent`.
const rowAgents = (r: OGResponsibility): string[] => r.agents ?? (r.agent ? [r.agent] : []);

// Holder name → executor slugs, straight from the gov edges. Duty/active-data/
// process-step rows carry a `govops` holder but no `executor` and (Core side)
// no prime chain — this lets the executor filter still match them.
function matches(
  r: OGResponsibility,
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
      // shared GovOps holder (Soter Labs serves both Amatsu and Ozone) from
      // leaking one executor's assignment row into the other's filter.
      (r.executor == null && agents.length === 0 && r.govops != null && holderExec.get(r.govops)?.has(filter.slug) === true)
    );
  // govops
  return (
    (r.govops != null && toAnchorId(r.govops) === filter.slug) ||
    agents.some((a) => {
      const n = chains.get(a)?.govopsName;
      return n != null && toAnchorId(n) === filter.slug;
    })
  );
}

// Definitions have no actor attribution — only show them with no active entity filter.
const extraRowFilter = (r: OGResponsibility, filter: ActiveFilter): boolean =>
  r.category === "definition" ? filter === null : true;

const govopsConfig: RoleReportConfig<OGResponsibility> = {
  reportId: "gov-ops-responsibilities",
  heading: "Operational GovOps Responsibilities",
  introText: "Every Atlas section mandating action from an Operational or Core GovOps.",
  introDocUuid: "1e73ee4b-823d-406a-af54-223b43bc8e42",
  introLinkSuffix: "GovOps",
  searches: SEARCHES,
  filename: "op-govops-responsibilities.csv",
  pillLabel: "GovOps",
  pillKind: "govops",
  edges: GOV_EDGES,
  categoryLabels: CATEGORY_LABELS,
  loadResponsibilities: deriveGovOpsResponsibilities,
  rowsToCSV: govopsRowsToCSV,
  searchFields: ogSearchFields,
  matches,
  extraRowFilter,
  CategoryTable: OGCategoryTable,
};

export function OGReport({ query, mode }: { query: string; mode: ReportMode }) {
  return <RoleResponsibilityReport query={query} mode={mode} config={govopsConfig} />;
}
