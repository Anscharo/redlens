// Data/filter-state hook backing RoleResponsibilityReport.tsx. Pulled out of
// the component so the render function stays under the file-size convention —
// this hook owns URL-synced filter state, chain resolution, and the filtered
// row set; the component is JSX only.
import { useMemo } from "react";
import { loadGraph } from "../../lib/graph";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, type UrlCodec } from "../../hooks/useUrlState";
import { toAnchorId } from "../../lib/anchorId";
import { track } from "../../lib/analytics";
import { buildChains, rolePills, holderExecutorSlugs, filterEqual, type ActiveFilter, type Chain } from "../../lib/reportChains";
import { categoryCodec } from "./CategoryPills";
import { filterRows, parseReportQuery, type ReportMode } from "../../lib/reportFilter";
import type { RoleRow } from "./RoleCategoryTable";
import type { RoleReportConfig } from "./roleReportTypes";

export function useRoleReportState<R extends RoleRow>(config: RoleReportConfig<R>, query: string, mode: ReportMode) {
  const graphData = useLoaded(loadGraph);
  const atlas = useLoaded(loadAtlas);

  const filterCodec = useMemo<UrlCodec<ActiveFilter>>(
    () => ({
      encode: (v) => (v === null ? null : `${v.kind}.${v.slug}`),
      decode: (raw) => {
        if (!raw) return null;
        const idx = raw.indexOf(".");
        if (idx === -1) return null;
        const kind = raw.slice(0, idx);
        const slug = raw.slice(idx + 1);
        return kind === config.pillKind || kind === "executor" || kind === "agent" ? { kind, slug } : null;
      },
    }),
    [config.pillKind],
  );
  const catCodec = useMemo(() => categoryCodec(config.categoryLabels), [config.categoryLabels]);

  const [filter, setFilter] = useUrlState("filter", filterCodec);
  const [cat, setCat] = useUrlState("cat", catCodec);

  const chains = useMemo(() => (graphData ? buildChains(graphData) : new Map<string, Chain>()), [graphData]);

  const responsibilities = useMemo(
    () => (atlas && graphData ? config.loadResponsibilities(atlas, graphData) : []),
    [atlas, graphData, config],
  );

  // Pill lists come from the role edges (not the prime chains) so the Core
  // side is filterable too — see buildChains' doc comment on why chains alone
  // silently drop Core-only holders/executors.
  const pills = useMemo(
    () => (graphData ? rolePills(graphData, config.edges) : { holders: [], executors: [] }),
    [graphData, config.edges],
  );
  const allAgents = useMemo(() => [...chains.keys()], [chains]);
  const holderExec = useMemo(
    () => (graphData ? holderExecutorSlugs(graphData, config.edges) : new Map<string, Set<string>>()),
    [graphData, config.edges],
  );

  const toggle = (next: ActiveFilter) => {
    const cleared = filterEqual(filter, next);
    track("report_filter", {
      report: config.reportId,
      filter_kind: next?.kind ?? null,
      slug: next && "slug" in next ? next.slug : null,
      active: !cleared,
    });
    setFilter((cur) => (filterEqual(cur, next) ? null : next));
  };

  const toggleCat = (next: R["category"]) => {
    track("report_filter", { report: config.reportId, filter_kind: "category", slug: next, active: cat !== next });
    setCat((cur) => (cur === next ? null : next));
  };

  const rq = useMemo(() => parseReportQuery(query, mode), [query, mode]);
  const filtered = filterRows(
    responsibilities.filter(
      (r) =>
        (cat === null || r.category === cat) &&
        (config.extraRowFilter?.(r, filter) ?? true) &&
        config.matches(r, filter, chains, holderExec),
    ),
    rq,
    config.searchFields,
  );

  // Display name of the active entity filter — the pill whose anchor-id slug
  // matches (pills derive their slugs from these same names).
  const filterName = filter
    ? ([...pills.holders.map((p) => p.name), ...pills.executors.map((p) => p.name), ...allAgents].find(
        (n) => toAnchorId(n) === filter.slug,
      ) ?? filter.slug)
    : null;

  const presentCats = useMemo(
    () => (Object.keys(config.categoryLabels) as R["category"][]).filter((c) => responsibilities.some((r) => r.category === c)),
    [responsibilities, config.categoryLabels],
  );

  const byCategory = Object.groupBy(filtered, (r) => r.category) as Record<R["category"], R[]>;
  const introDocNo = atlas?.docs[config.introDocUuid]?.doc_no;

  return {
    filter,
    cat,
    chains,
    responsibilities,
    toggle,
    toggleCat,
    rq,
    filtered,
    filterName,
    presentCats,
    byCategory,
    introDocNo,
    pills,
    allAgents,
  };
}
