// Data/filter-state hook backing RoleResponsibilityReport.tsx: it owns the
// URL-synced filter state, chain resolution and the filtered row set, so the
// component is JSX only.
import { useMemo } from "react";
import { loadGraph, type GraphData } from "../../lib/graph";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { urlTagged, useUrlState, type UrlCodec } from "../../hooks/useUrlState";
import { toAnchorId } from "../../lib/anchorId";
import { buildChains, rolePills, holderExecutorSlugs, filterEqual, type ActiveFilter, type EntityFilter, type Chain } from "../../lib/reportChains";
import { categoryCodec } from "./CategoryPills";
import { trackReportFilter, useReportQuery } from "./useReportQuery";
import { filterRows, type ReportMode } from "@/lib/reportFilter";
import type { RoleRow } from "./RoleCategoryTable";
import type { RoleReportConfig } from "./roleReportTypes";

type Config<R extends RoleRow> = RoleReportConfig<R>;

/** The entity pill (`kind.slug` in one param: the pill group plus the pill) and the category pill. */
function useRoleFilters<R extends RoleRow>(config: Config<R>) {
  // Kinds outside the report's own set decode to null, so a stale link clears the filter.
  const filterCodec = useMemo(
    () => urlTagged([config.pillKind, "executor", "agent"] as const) as UrlCodec<ActiveFilter>,
    [config.pillKind],
  );
  const catCodec = useMemo(() => categoryCodec(config.categoryLabels), [config.categoryLabels]);
  const [filter, setFilter] = useUrlState("filter", filterCodec);
  const [cat, setCat] = useUrlState("cat", catCodec);
  // Pills click an entity (never null); re-clicking the active one clears.
  const toggle = (next: EntityFilter) => {
    const active = !filterEqual(filter, next);
    trackReportFilter(config.reportId, next.kind, active ? next.slug : null, active);
    setFilter((cur) => (filterEqual(cur, next) ? null : next));
  };
  const toggleCat = (next: R["category"]) => {
    const active = cat !== next;
    trackReportFilter(config.reportId, "category", active ? next : null, active);
    setCat((cur) => (cur === next ? null : next));
  };
  return { filter, cat, toggle, toggleCat };
}

/** Prime-agent chains and the report's rows. */
function useRoleRows<R extends RoleRow>(config: Config<R>) {
  const graphData = useLoaded(loadGraph);
  const atlas = useLoaded(loadAtlas);
  const chains = useMemo(() => (graphData ? buildChains(graphData) : new Map<string, Chain>()), [graphData]);
  const responsibilities = useMemo(
    () => (atlas && graphData ? config.loadResponsibilities(atlas, graphData) : []),
    [atlas, graphData, config],
  );
  const presentCats = useMemo(
    () => (Object.keys(config.categoryLabels) as R["category"][]).filter((c) => responsibilities.some((r) => r.category === c)),
    [responsibilities, config.categoryLabels],
  );
  return { graphData, chains, responsibilities, presentCats, introDocNo: atlas?.docs[config.introDocUuid]?.doc_no };
}

// Pill lists come from the role edges (not the prime chains) so the Core side
// is filterable too — see buildChains' doc comment on why chains alone
// silently drop Core-only holders/executors.
function useRolePills<R extends RoleRow>(config: Config<R>, graphData: GraphData | null) {
  const pills = useMemo(
    () => (graphData ? rolePills(graphData, config.edges) : { holders: [], executors: [] }),
    [graphData, config.edges],
  );
  const holderExec = useMemo(
    () => (graphData ? holderExecutorSlugs(graphData, config.edges) : new Map<string, Set<string>>()),
    [graphData, config.edges],
  );
  return { pills, holderExec };
}

/** Display name of the active entity filter: the pill whose anchor-id slug matches
 *  (pills derive their slugs from these same names). */
function activeFilterName(filter: ActiveFilter, pills: ReturnType<typeof rolePills>, allAgents: string[]): string | null {
  if (!filter) return null;
  const names = [...pills.holders.map((p) => p.name), ...pills.executors.map((p) => p.name), ...allAgents];
  return names.find((n) => toAnchorId(n) === filter.slug) ?? filter.slug;
}

export function useRoleReportState<R extends RoleRow>(config: Config<R>, query: string, mode: ReportMode) {
  const { filter, cat, toggle, toggleCat } = useRoleFilters(config);
  const { graphData, chains, responsibilities, presentCats, introDocNo } = useRoleRows(config);
  const { pills, holderExec } = useRolePills(config, graphData);
  const allAgents = useMemo(() => [...chains.keys()], [chains]);
  const rq = useReportQuery(query, mode);
  const matching = responsibilities.filter(
    (r) =>
      (cat === null || r.category === cat) &&
      (config.extraRowFilter?.(r, filter) ?? true) &&
      config.matches(r, filter, chains, holderExec),
  );
  const filtered = filterRows(matching, rq, config.searchFields);
  const byCategory = Object.groupBy(filtered, (r) => r.category) as Record<R["category"], R[]>;
  const filterName = activeFilterName(filter, pills, allAgents);
  return { filter, cat, chains, responsibilities, toggle, toggleCat, rq, filtered, filterName, presentCats, byCategory, introDocNo, pills, allAgents };
}
