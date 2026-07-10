import { useMemo } from "react";
import { AtlasLink } from "../AtlasLink";
import { loadGraph } from "../../lib/graph";
import { loadAtlas } from "../../lib/docs";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUrlState, type UrlCodec } from "../../hooks/useUrlState";
import { atlasHref } from "../../lib/routes";
import { toAnchorId } from "../../lib/anchorId";
import { track } from "../../lib/analytics";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  buildChains,
  rolePills,
  holderExecutorSlugs,
  filterEqual,
  stripExecutorPrefix,
  type ActiveFilter,
  type Chain,
} from "../../lib/reportChains";
import { FAC_EDGES } from "../../lib/roleEdges";
import {
  CATEGORY_LABELS,
  type OFResponsibility,
  deriveFacilitatorResponsibilities,
} from "../../lib/facilitatorResponsibilities";
import { FilterPills, PrimePills } from "./FilterPills";
import { CategoryPills, categoryCodec } from "./CategoryPills";
import { OFCategoryTable, ofSearchFields } from "./OFCategoryTable";
import { fieldsHaystack, filterRows, queryTokens } from "../../lib/reportFilter";
import { NoRowsMatch } from "./NoRowsMatch";
import { FilterSummary } from "./FilterSummary";

const catCodec = categoryCodec(CATEGORY_LABELS);

// Header-box text filter over the fields declared in OFCategoryTable (which
// also tracks their per-category visibility for the hidden-match aside).
// Category is pill-owned and deliberately excluded.
const searchText = (r: OFResponsibility) => fieldsHaystack(ofSearchFields(r));
const SEARCHES = "doc no · title · duty text · role · facilitator · executor · prime agents";

const filterCodec: UrlCodec<ActiveFilter> = {
  encode: (v) => (v === null ? null : `${v.kind}.${v.slug}`),
  decode: (raw) => {
    if (!raw) return null;
    const idx = raw.indexOf(".");
    if (idx === -1) return null;
    const kind = raw.slice(0, idx);
    const slug = raw.slice(idx + 1);
    return kind === "facilitator" || kind === "executor" || kind === "agent"
      ? { kind, slug }
      : null;
  },
};

export function OFReport({ query }: { query: string }) {
  useDocumentTitle("Operational Facilitator Responsibilities: Sky Atlas by Redline");
  const graphData = useLoaded(loadGraph);
  const atlas = useLoaded(loadAtlas);
  const [filter, setFilter] = useUrlState("filter", filterCodec);
  const [cat, setCat] = useUrlState("cat", catCodec);

  const chains = useMemo(() => (graphData ? buildChains(graphData) : new Map<string, Chain>()), [graphData]);

  const responsibilities = useMemo(
    () => (atlas && graphData ? deriveFacilitatorResponsibilities(atlas, graphData) : []),
    [atlas, graphData],
  );

  // Pill lists come from the fac edges (not the prime chains) so the Core side
  // — the Core Facilitator org, Core Council Executor Agent 1 — is filterable too.
  const pills = useMemo(
    () => (graphData ? rolePills(graphData, FAC_EDGES) : { holders: [], executors: [] }),
    [graphData],
  );

  const allAgents = useMemo(() => [...chains.keys()], [chains]);

  // Holder name → executor slugs, straight from the fac edges. Duty/active-data/
  // process-step rows carry a `facilitator` holder but no `executor` and (Core
  // side) no prime chain — this lets the executor filter still match them.
  const holderExec = useMemo(
    () => (graphData ? holderExecutorSlugs(graphData, FAC_EDGES) : new Map<string, Set<string>>()),
    [graphData],
  );

  const toggle = (next: ActiveFilter) => {
    const cleared = filterEqual(filter, next);
    track("report_filter", {
      report: "of-responsibilities",
      filter_kind: next?.kind ?? null,
      slug: next && "slug" in next ? next.slug : null,
      active: !cleared,
    });
    setFilter((cur) => (filterEqual(cur, next) ? null : next));
  };

  const toggleCat = (next: OFResponsibility["category"]) => {
    track("report_filter", {
      report: "of-responsibilities",
      filter_kind: "category",
      slug: next,
      active: cat !== next,
    });
    setCat((cur) => (cur === next ? null : next));
  };

  const rowAgents = (r: OFResponsibility): string[] =>
    r.agents ?? (r.agent ? [r.agent] : []);
  const rowFacs = (r: OFResponsibility): string[] =>
    r.facilitators ?? (r.facilitator ? [r.facilitator] : []);

  const matches = (r: OFResponsibility): boolean => {
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
        (r.executor == null &&
          agents.length === 0 &&
          rowFacs(r).some((f) => holderExec.get(f)?.has(filter.slug) === true))
      );
    // facilitator
    return (
      rowFacs(r).some((f) => toAnchorId(f) === filter.slug) ||
      agents.some((a) => {
        const n = chains.get(a)?.facilitatorName;
        return !!n && toAnchorId(n) === filter.slug;
      })
    );
  };

  const tokens = useMemo(() => queryTokens(query), [query]);
  const filtered = filterRows(
    responsibilities.filter((r) => (cat === null || r.category === cat) && matches(r)),
    query,
    searchText,
  );

  // Display name of the active entity filter — the pill whose anchor-id slug
  // matches (pills derive their slugs from these same names).
  const filterName = filter
    ? ([...pills.holders.map((p) => p.name), ...pills.executors.map((p) => p.name), ...allAgents].find(
        (n) => toAnchorId(n) === filter.slug,
      ) ?? filter.slug)
    : null;

  const presentCats = useMemo(
    () =>
      (Object.keys(CATEGORY_LABELS) as OFResponsibility["category"][]).filter((c) =>
        responsibilities.some((r) => r.category === c),
      ),
    [responsibilities],
  );

  const byCategory = Object.groupBy(filtered, (r) => r.category) as Record<
    OFResponsibility["category"],
    OFResponsibility[]
  >;

  return (
    <div className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Operational Facilitator Responsibilities
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          Every Atlas section mandating action from a Facilitator.{" "}
          <AtlasLink
            to={atlasHref("1ce24b08-84ff-4524-9710-49bba429c6ef")}
            className="text-accent hover:underline"
          >
            A.1.7 Facilitators ↗
          </AtlasLink>
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          <FilterPills label="Facilitator" items={pills.holders} kind="facilitator" filter={filter} onToggle={toggle} />
          <FilterPills label="Executor" items={pills.executors} kind="executor" filter={filter} onToggle={toggle} />
          <PrimePills agents={allAgents} filter={filter} onToggle={toggle} />
          <CategoryPills categories={presentCats} active={cat} onToggle={toggleCat} />
        </div>

        <FilterSummary query={query} filters={[filterName, cat && CATEGORY_LABELS[cat]]} searches={SEARCHES} />
        {responsibilities.length > 0 && filtered.length === 0 && <NoRowsMatch query={query} />}
        {(Object.entries(CATEGORY_LABELS) as [OFResponsibility["category"], string][]).map(
          ([cat, label]) => {
            const rows = byCategory[cat];
            if (!rows?.length) return null;
            return <OFCategoryTable key={cat} cat={cat} label={label} rows={rows} chains={chains} tokens={tokens} />;
          },
        )}
      </div>
    </div>
  );
}
