import { useMemo } from "react";
import { AtlasLink } from "../AtlasLink";
import { loadGraph, type GraphData } from "../../lib/graph";
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
  type OGResponsibility,
  deriveGovOpsResponsibilities,
} from "../../lib/govopsResponsibilities";

// slug = toAnchorId(name) — URL-safe. Names are slugified at compare-time so raw
// names never enter the URL.
type ActiveFilter =
  | { kind: "govops"; slug: string }
  | { kind: "executor"; slug: string }
  | { kind: "agent"; slug: string }
  | null;

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

function filterEqual(a: ActiveFilter, b: ActiveFilter): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.slug === b.slug;
}

interface Chain {
  agentId: string;
  executorName: string;
  executorId: string;
  govopsName: string;
  govopsId: string;
}

// Prime name → its executor + govops, resolved via the role-as-edge chain.
function buildChains(graph: GraphData): Map<string, Chain> {
  const entityById = new Map<string, GraphEntity>(graph.participants.map((e) => [e.id, e]));
  const execEdges = graph.edges.filter((e) => e.e === "operational_executor_agent_for");
  const govEdges = graph.edges.filter((e) => e.e === "operational_govops_for" || e.e === "core_govops_for");
  const primes = graph.participants.filter((e) => e.et === "agent" && e.st === "prime");
  const map = new Map<string, Chain>();
  for (const prime of primes) {
    const execEdge = execEdges.find((e) => e.t === prime.id);
    const executor = execEdge ? entityById.get(execEdge.f) : null;
    if (!executor) continue;
    const govEdge = govEdges.find((e) => e.t === executor.id);
    const gov = govEdge ? entityById.get(govEdge.f) : null;
    map.set(prime.name, {
      agentId: prime.id,
      executorName: executor.name.replace(/^(Operational|Core Council) Executor Agent\s+/i, ""),
      executorId: executor.id,
      govopsName: gov?.name ?? "",
      govopsId: gov?.id ?? "",
    });
  }
  return map;
}

function AgentChips({ agents, chains }: { agents: string[]; chains: Map<string, Chain> }) {
  if (!agents.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {agents.map((a) => {
        const c = chains.get(a);
        return c ? (
          <AtlasLink
            key={a}
            to={atlasHref(c.agentId)}
            className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors"
          >
            {a}
          </AtlasLink>
        ) : (
          <span key={a} className="mono text-xs px-1.5 py-0.5 text-tan-3">{a}</span>
        );
      })}
    </div>
  );
}

function DocCell({ r }: { r: OGResponsibility }) {
  return r.uuid ? (
    <AtlasLink to={atlasHref(r.uuid)} className="mono text-xs text-accent hover:underline text-left">
      {r.docNo}
    </AtlasLink>
  ) : (
    <span className="mono text-xs text-tan-3 text-left">{r.docNo}</span>
  );
}

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

  const govopsOrgs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of chains.values()) if (c.govopsId && !seen.has(c.govopsId)) seen.set(c.govopsId, c.govopsName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [chains]);

  const executors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of chains.values()) if (!seen.has(c.executorId)) seen.set(c.executorId, c.executorName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [chains]);

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
        (r.executor != null && toAnchorId(r.executor.replace(/^(Operational|Core Council) Executor Agent\s+/i, "")) === filter.slug) ||
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

  const Pills = ({ label, items, kind }: { label: string; items: { id: string; name: string }[]; kind: "govops" | "executor" }) =>
    items.length > 0 ? (
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-xs text-tan-3 mr-1">{label}:</span>
        {items.map((f) => {
          const slug = toAnchorId(f.name);
          return (
            <button
              key={f.id}
              onClick={() => toggle({ kind, slug })}
              data-active={filter?.kind === kind && filter.slug === slug ? "true" : undefined}
              className="scope-pill text-xs px-2 py-0.5 rounded"
            >
              {f.name}
            </button>
          );
        })}
      </div>
    ) : null;

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
          <Pills label="GovOps" items={govopsOrgs} kind="govops" />
          <Pills label="Executor" items={executors} kind="executor" />
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
            return (
              <div key={cat} className="mb-8">
                <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">
                  {label} <span className="text-tan-3/60">({rows.length})</span>
                </h2>
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs mono text-tan-3">
                      <th className="py-1 px-3 font-normal w-44">Doc</th>
                      {cat === "assignment" ? (
                        <>
                          <th className="py-1 px-3 font-normal">Executor Agent</th>
                          <th className="py-1 px-3 font-normal w-40">GovOps</th>
                          <th className="py-1 px-3 font-normal">Prime Agents</th>
                        </>
                      ) : (
                        <>
                          <th className="py-1 px-3 font-normal">Section</th>
                          <th className="py-1 px-3 font-normal">Duty</th>
                          {(cat === "active-data" || cat === "process-step") && (
                            <th className="py-1 px-3 font-normal w-36">GovOps</th>
                          )}
                          {(cat === "op-duty" ||
                            cat === "core-duty" ||
                            cat === "active-data" ||
                            cat === "process-step") && (
                            <th className="py-1 px-3 font-normal w-36">Prime</th>
                          )}
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={`${cat}:${r.uuid || r.docNo}:${r.govops ?? ""}`}
                        className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors"
                      >
                        <td className="py-2 px-3 align-top"><DocCell r={r} /></td>
                        {cat === "assignment" ? (
                          <>
                            <td className="py-2 px-3 align-top text-sm text-tan">
                              {r.executor?.replace(/^(Operational|Core Council) Executor Agent\s+/i, "") ?? "—"}
                            </td>
                            <td className="py-2 px-3 align-top text-sm text-accent">{r.govops ?? "—"}</td>
                            <td className="py-2 px-3 align-top">
                              <AgentChips agents={r.agents ?? []} chains={chains} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
                            <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
                            {(cat === "active-data" || cat === "process-step") && (
                              <td className="py-2 px-3 align-top text-sm text-accent">{r.govops ?? "—"}</td>
                            )}
                            {(cat === "op-duty" || cat === "core-duty") && (
                              <td className="py-2 px-3 align-top">
                                <AgentChips agents={r.agents ?? []} chains={chains} />
                              </td>
                            )}
                            {(cat === "active-data" || cat === "process-step") && (
                              <td className="py-2 px-3 align-top">
                                <AgentChips agents={r.agent ? [r.agent] : []} chains={chains} />
                              </td>
                            )}
                          </>
                        )}
                      </tr>
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
