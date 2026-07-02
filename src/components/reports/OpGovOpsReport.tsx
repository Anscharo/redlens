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
  filterEqual,
  stripExecutorPrefix,
  type ActiveFilter,
  type Chain,
} from "../../lib/reportChains";
import {
  CATEGORY_LABELS,
  type OGResponsibility,
  deriveGovOpsResponsibilities,
} from "../../lib/govopsResponsibilities";
import { FilterPills } from "./FilterPills";
import { OGCategoryTable } from "./OGCategoryTable";

const filterCodec: UrlCodec<ActiveFilter> = {
  encode: (v) => (v === null ? null : `${v.kind}.${v.slug}`),
  decode: (raw) => {
    if (!raw) return null;
    const idx = raw.indexOf(".");
    if (idx === -1) return null;
    const kind = raw.slice(0, idx);
    const slug = raw.slice(idx + 1);
    return kind === "govops" || kind === "executor" || kind === "agent"
      ? { kind, slug }
      : null;
  },
};

export function OGReport() {
  useDocumentTitle("Operational GovOps Responsibilities: Sky Atlas by Redline");
  const graphData = useLoaded(loadGraph);
  const atlas = useLoaded(loadAtlas);
  const [filter, setFilter] = useUrlState("filter", filterCodec);

  const chains = useMemo(() => (graphData ? buildChains(graphData) : new Map<string, Chain>()), [graphData]);

  const responsibilities = useMemo(
    () => (atlas && graphData ? deriveGovOpsResponsibilities(atlas, graphData) : []),
    [atlas, graphData],
  );

  // Pill lists come from the gov edges (not the prime chains) so the Core side
  // — Atlas Axis, Core Council Executor Agent 1 — is filterable too.
  const pills = useMemo(
    () => (graphData ? rolePills(graphData) : { govops: [], executors: [] }),
    [graphData],
  );

  const allAgents = useMemo(() => [...chains.keys()], [chains]);

  const toggle = (next: ActiveFilter) => {
    const cleared = filterEqual(filter, next);
    track("report_filter", {
      report: "gov-ops-responsibilities",
      filter_kind: next?.kind ?? null,
      slug: next && "slug" in next ? next.slug : null,
      active: !cleared,
    });
    setFilter((cur) => (filterEqual(cur, next) ? null : next));
  };

  // Which primes does a row cover? assignment/duty rows carry `agents`;
  // active-data rows carry a single `agent`.
  const rowAgents = (r: OGResponsibility): string[] =>
    r.agents ?? (r.agent ? [r.agent] : []);

  const matches = (r: OGResponsibility): boolean => {
    if (filter === null) return true;
    const agents = rowAgents(r);
    if (filter.kind === "agent") return agents.some((a) => toAnchorId(a) === filter.slug);
    if (filter.kind === "executor")
      return (
        (r.executor != null && toAnchorId(stripExecutorPrefix(r.executor)) === filter.slug) ||
        agents.some((a) => {
          const n = chains.get(a)?.executorName;
          return n != null && toAnchorId(n) === filter.slug;
        })
      );
    // govops
    return (
      (r.govops != null && toAnchorId(r.govops) === filter.slug) ||
      agents.some((a) => {
        const n = chains.get(a)?.govopsName;
        return n != null && toAnchorId(n) === filter.slug;
      })
    );
  };

  // Definitions have no actor attribution — only show them with no active filter.
  const filtered = responsibilities.filter((r) =>
    r.category === "definition" ? filter === null : matches(r),
  );

  const byCategory = Object.groupBy(filtered, (r) => r.category) as Record<
    OGResponsibility["category"],
    OGResponsibility[]
  >;

  return (
    <div className="px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>
          Operational GovOps Responsibilities
        </h1>
        <p className="text-sm text-tan-3 mb-5">
          Every Atlas section mandating action from an Operational or Core GovOps.{" "}
          <AtlasLink
            to={atlasHref("1e73ee4b-823d-406a-af54-223b43bc8e42")}
            className="text-accent hover:underline"
          >
            A.0.1.1.47 GovOps ↗
          </AtlasLink>
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          <FilterPills label="GovOps" items={pills.govops} kind="govops" filter={filter} onToggle={toggle} />
          <FilterPills label="Executor" items={pills.executors} kind="executor" filter={filter} onToggle={toggle} />
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Prime:</span>
            {allAgents.map((a) => {
              const slug = toAnchorId(a);
              return (
                <button
                  key={a}
                  onClick={() => toggle({ kind: "agent", slug })}
                  data-active={filter?.kind === "agent" && filter.slug === slug ? "true" : undefined}
                  className="scope-pill mono text-xs px-2 py-0.5 rounded"
                >
                  {a}
                </button>
              );
            })}
          </div>
        </div>

        {(Object.entries(CATEGORY_LABELS) as [OGResponsibility["category"], string][]).map(
          ([cat, label]) => {
            const rows = byCategory[cat];
            if (!rows?.length) return null;
            return <OGCategoryTable key={cat} cat={cat} label={label} rows={rows} chains={chains} />;
          },
        )}
      </div>
    </div>
  );
}
