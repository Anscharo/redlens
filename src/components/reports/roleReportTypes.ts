// Shared config contract for the role-responsibility reports (Operational
// Facilitator, Operational GovOps). Split from RoleResponsibilityReport.tsx /
// useRoleReportState.ts so both can import it without a circular dependency.
import type { GraphData } from "../../lib/graph";
import type { AtlasBundle } from "../../lib/docs";
import type { ActiveFilter, Chain } from "../../lib/reportChains";
import type { ReportQuery, SearchField } from "../../lib/reportFilter";
import type { RoleRow } from "./RoleCategoryTable";

export interface RoleReportConfig<R extends RoleRow> {
  reportId: string; // analytics report id + CSV export slug
  documentTitle: string; // useDocumentTitle
  heading: string; // h1 text
  introText: string; // sentence before the atlas link ("Every Atlas section mandating...")
  introDocUuid: string; // atlas link target; also the doc_no source (never hardcode the label)
  introLinkSuffix: string; // e.g. "Facilitators" | "GovOps", appended after the resolved doc_no
  searches: string; // FilterSummary "searched fields" string
  filename: string; // CSV filename
  pillLabel: string; // FilterPills label for the role-holder pill group
  pillKind: "facilitator" | "govops"; // FilterPills kind + the role slot in the URL filter codec
  edges: Set<string>; // FAC_EDGES | GOV_EDGES — rolePills/holderExecutorSlugs edge set
  categoryLabels: Record<R["category"], string>;
  loadResponsibilities: (atlas: AtlasBundle, graph: GraphData) => R[];
  rowsToCSV: (rows: readonly R[]) => string;
  searchFields: (r: R) => SearchField[];
  matches: (r: R, filter: ActiveFilter, chains: Map<string, Chain>, holderExec: Map<string, Set<string>>) => boolean;
  // Extra per-row gate ANDed with matches() — e.g. GovOps definitions only show with no active entity filter.
  extraRowFilter?: (r: R, filter: ActiveFilter) => boolean;
  CategoryTable: React.ComponentType<{ cat: R["category"]; label: string; rows: R[]; chains: Map<string, Chain>; rq?: ReportQuery }>;
}
