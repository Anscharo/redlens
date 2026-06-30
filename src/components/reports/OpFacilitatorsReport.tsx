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
import type { GraphEntity } from "../../types";
import {
  CATEGORY_LABELS,
  type OFResponsibility,
  deriveResponsibilities,
} from "../../lib/facilitatorResponsibilities";

// The `slug` is toAnchorId(name) — URL-safe lowercase-hyphenated. Row names
// from the graph are slugified at compare-time so we never put raw names in
// the URL (no %3A, no + for spaces).
type ActiveFilter =
  | { kind: "core" }
  | { kind: "facilitator"; slug: string }
  | { kind: "executor"; slug: string }
  | { kind: "agent"; slug: string }
  | null;

const filterCodec: UrlCodec<ActiveFilter> = {
  encode: (v) => {
    if (v === null) return null;
    if (v.kind === "core") return "core";
    return `${v.kind}.${v.slug}`;
  },
  decode: (raw) => {
    if (!raw) return null;
    if (raw === "core") return { kind: "core" };
    const idx = raw.indexOf(".");
    if (idx === -1) return null;
    const kind = raw.slice(0, idx);
    const slug = raw.slice(idx + 1);
    if (kind === "facilitator" || kind === "executor" || kind === "agent") {
      return { kind, slug };
    }
    return null;
  },
};

function filterEqual(a: ActiveFilter, b: ActiveFilter): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === "core") return true;
  return a.slug === (b as { slug: string }).slug;
}

interface AgentChain {
  agentName: string;
  agentId: string;
  executorName: string;
  executorId: string;
  facilitatorName: string;
  facilitatorId: string;
  govopsName: string;
  govopsId: string;
}

function Row({ r, chains }: { r: OFResponsibility; chains: Map<string, AgentChain> }) {
  const agentNames = useMemo(
    () => r.agents ?? (r.agent ? [r.agent] : []),
    [r.agents, r.agent],
  );

  const facilitators = useMemo(() => {
    const seen = new Map<string, AgentChain>();
    for (const a of agentNames) {
      const c = chains.get(a);
      if (c && !seen.has(c.facilitatorId)) seen.set(c.facilitatorId, c);
    }
    return [...seen.values()];
  }, [agentNames, chains]);

  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top">
        {r.uuid ? (
          <AtlasLink
            to={atlasHref(r.uuid)}
            className="mono text-xs text-accent hover:underline text-left"
          >
            {r.docNo}
          </AtlasLink>
        ) : (
          <span className="mono text-xs text-tan-3 text-left">{r.docNo}</span>
        )}
      </td>
      <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
      <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
      <td className="py-2 px-3 align-top">
        {agentNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {agentNames.map((a) => {
              const c = chains.get(a);
              if (!c) return null;
              return (
                <AtlasLink
                  key={a}
                  to={atlasHref(c.agentId)}
                  className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors"
                >
                  {a}
                </AtlasLink>
              );
            })}
          </div>
        ) : null}
      </td>
      <td className="py-2 px-3 align-top">
        {facilitators.map((c) => (
          <div key={c.facilitatorId} className="flex items-center gap-1.5 mb-0.5">
            <AtlasLink
              to={atlasHref(c.executorId)}
              className="mono text-[10px] text-tan-3 hover:text-tan hover:underline"
            >
              {c.executorName}
            </AtlasLink>
            <span className="text-tan-3 text-[10px]">/</span>
            <AtlasLink
              to={atlasHref(c.facilitatorId)}
              className="text-xs text-accent hover:underline"
            >
              {c.facilitatorName}
            </AtlasLink>
          </div>
        ))}
      </td>
    </tr>
  );
}

export function OFReport() {
  useDocumentTitle("Operational Facilitator Responsibilities: Sky Atlas by Redline");
  const graphData = useLoaded(loadGraph);
  const atlas = useLoaded(loadAtlas);
  const [filter, setFilter] = useUrlState("filter", filterCodec);

  const chains = useMemo<Map<string, AgentChain>>(() => {
    if (!graphData) return new Map();
    const { participants, edges } = graphData;
    const entityById = new Map<string, GraphEntity>(participants.map((e) => [e.id, e]));
    const execAgentEdges = edges.filter((e) => e.e === "operational_executor_agent_for");
    const facEdges = edges.filter((e) => e.e === "operational_facilitator_for");
    const govEdges = edges.filter((e) => e.e === "operational_govops_for");
    const primes = participants.filter((e) => e.et === "agent" && e.st === "prime");
    const map = new Map<string, AgentChain>();
    for (const prime of primes) {
      const execEdge = execAgentEdges.find((e) => e.t === prime.id);
      const executor = execEdge ? entityById.get(execEdge.f) : null;
      if (!executor) continue;
      const facEdge = facEdges.find((e) => e.t === executor.id);
      const govEdge = govEdges.find((e) => e.t === executor.id);
      const fac = facEdge ? entityById.get(facEdge.f) : null;
      const gov = govEdge ? entityById.get(govEdge.f) : null;
      if (!fac) continue;
      map.set(prime.name, {
        agentName: prime.name,
        agentId: prime.id,
        executorName: executor.name.replace(/^(Operational|Core Council) Executor Agent\s+/i, ""),
        executorId: executor.id,
        facilitatorName: fac.name,
        facilitatorId: fac.id,
        govopsName: gov?.name ?? "",
        govopsId: gov?.id ?? "",
      });
    }
    return map;
  }, [graphData]);

  const responsibilities = useMemo(
    () => (atlas && graphData ? deriveResponsibilities(atlas, graphData) : []),
    [atlas, graphData],
  );

  const allAgents = useMemo(
    () => [...new Set(responsibilities.flatMap((r) => r.agents ?? (r.agent ? [r.agent] : [])))],
    [responsibilities],
  );

  const facilitators = useMemo(() => {
    const seen = new Map<string, string>();
    for (const [, c] of chains) {
      if (!seen.has(c.facilitatorId)) seen.set(c.facilitatorId, c.facilitatorName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [chains]);

  const executors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const [, c] of chains) {
      if (!seen.has(c.executorId)) seen.set(c.executorId, c.executorName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [chains]);

  const coreFacilitator = useMemo(() => {
    if (!graphData) return null;
    const edge = graphData.edges.find((e) => e.e === "core_facilitator_for");
    return edge ? (graphData.participants.find((p) => p.id === edge.f) ?? null) : null;
  }, [graphData]);

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

  const filtered = responsibilities.flatMap((r) => {
    const expanded: OFResponsibility[] = r.agents
      ? r.agents.map((a) => ({ ...r, agents: undefined, agent: a }))
      : [r];
    return expanded.filter((row) => {
      const isCF = row.category === "core-facilitator";
      if (filter?.kind === "core") return isCF;
      if (isCF) return filter === null;
      const agentNames = row.agent ? [row.agent] : [];
      if (filter?.kind === "agent")
        return agentNames.some((a) => toAnchorId(a) === filter.slug);
      if (filter?.kind === "executor")
        return agentNames.some((a) => {
          const n = chains.get(a)?.executorName;
          return n != null && toAnchorId(n) === filter.slug;
        });
      if (filter?.kind === "facilitator")
        return agentNames.some((a) => {
          const n = chains.get(a)?.facilitatorName;
          return n != null && toAnchorId(n) === filter.slug;
        });
      return true;
    });
  });

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
          Every Atlas section mandating action from an Operational Facilitator.{" "}
          <AtlasLink
            to={atlasHref("1ce24b08-84ff-4524-9710-49bba429c6ef")}
            className="text-accent hover:underline"
          >
            A.1.6 Facilitators ↗
          </AtlasLink>
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          {coreFacilitator && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Core:</span>
              <button
                onClick={() => toggle({ kind: "core" })}
                data-active={filter?.kind === "core" ? "true" : undefined}
                className="scope-pill text-xs px-2 py-0.5 rounded"
              >
                {coreFacilitator.name}
              </button>
            </div>
          )}
          {facilitators.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Facilitator:</span>
              {facilitators.map((f) => {
                const slug = toAnchorId(f.name);
                return (
                  <button
                    key={f.id}
                    onClick={() => toggle({ kind: "facilitator", slug })}
                    data-active={filter?.kind === "facilitator" && filter.slug === slug ? "true" : undefined}
                    className="scope-pill text-xs px-2 py-0.5 rounded"
                  >
                    {f.name}
                  </button>
                );
              })}
            </div>
          )}
          {executors.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Executor:</span>
              {executors.map((e) => {
                const slug = toAnchorId(e.name);
                return (
                  <button
                    key={e.id}
                    onClick={() => toggle({ kind: "executor", slug })}
                    data-active={filter?.kind === "executor" && filter.slug === slug ? "true" : undefined}
                    className="scope-pill text-xs px-2 py-0.5 rounded"
                  >
                    {e.name}
                  </button>
                );
              })}
            </div>
          )}
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

        {(Object.entries(CATEGORY_LABELS) as [OFResponsibility["category"], string][]).map(
          ([cat, label]) => {
            const rows = byCategory[cat];
            if (!rows?.length) return null;
            if (cat === "universal" || cat === "core-facilitator") {
              return (
                <div key={cat} className="mb-8">
                  <div className="flex items-center gap-3 mb-3 pb-1 border-b border-[var(--border)]">
                    <h2 className="text-xs mono text-tan-3 uppercase tracking-wider flex-1">{label}</h2>
                    {cat === "core-facilitator" && coreFacilitator?.did && (
                      <AtlasLink to={atlasHref(coreFacilitator.did)} className="text-xs text-accent hover:underline">
                        {coreFacilitator.name} ↗
                      </AtlasLink>
                    )}
                  </div>
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-xs mono text-tan-3">
                        <th className="py-1 px-3 font-normal w-44">Doc</th>
                        <th className="py-1 px-3 font-normal">Section</th>
                        <th className="py-1 px-3 font-normal">Duty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.docNo} className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                          <td className="py-2 px-3 align-top">
                            {r.uuid ? (
                              <AtlasLink to={atlasHref(r.uuid)} className="mono text-xs text-accent hover:underline text-left">
                                {r.docNo}
                              </AtlasLink>
                            ) : (
                              <span className="mono text-xs text-tan-3 text-left">{r.docNo}</span>
                            )}
                          </td>
                          <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
                          <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }
            return (
              <div key={cat} className="mb-8">
                <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
                  {label}
                </h2>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs mono text-tan-3">
                      <th className="py-1 px-3 font-normal w-44">Doc</th>
                      <th className="py-1 px-3 font-normal">Section</th>
                      <th className="py-1 px-3 font-normal">Duty</th>
                      <th className="py-1 px-3 font-normal w-36">Prime</th>
                      <th className="py-1 px-3 font-normal w-48">OEA / Facilitator</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Row key={r.docNo} r={r} chains={chains} />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}
