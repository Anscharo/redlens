import { useState, useEffect, useMemo } from "react";
import { loadGraph } from "../../lib/graph";
import type { RelationEntity } from "../../types";
import { OF_RESPONSIBILITIES, CATEGORY_LABELS, type OFResponsibility } from "../../data/precalculated/ofResponsibilities";

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

function useAgentChains(): Map<string, AgentChain> {
  const [chains, setChains] = useState<Map<string, AgentChain>>(new Map());

  useEffect(() => {
    loadGraph().then(({ entities, edges }) => {
      const entityById = new Map<string, RelationEntity>(entities.map(e => [e.id, e]));
      const accords = edges.filter(e => e.e === "executor_accord");
      const memberOf = edges.filter(e => e.e === "member_of");
      const primes = entities.filter(e => e.et === "agent" && e.st === "prime");

      const map = new Map<string, AgentChain>();
      for (const prime of primes) {
        const accord = accords.find(e => e.f === prime.id);
        const executor = accord ? entityById.get(accord.t) : null;
        if (!executor) continue;
        const members = memberOf.filter(e => e.t === executor.id);
        const facEdge = members.find(e => { try { return (JSON.parse(e.m ?? "{}") as { role?: string }).role?.includes("facilitator"); } catch { return false; } });
        const govEdge = members.find(e => { try { return (JSON.parse(e.m ?? "{}") as { role?: string }).role === "govops"; } catch { return false; } });
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
      setChains(map);
    });
  }, []);

  return chains;
}

function Row({ r, chains, onNavigate }: { r: OFResponsibility; chains: Map<string, AgentChain>; onNavigate: (id: string) => void }) {
  const agentNames = r.agents ?? (r.agent ? [r.agent] : []);

  // Collect unique facilitators across all agents for this row
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
        <button onClick={() => r.uuid && onNavigate(r.uuid)} disabled={!r.uuid}
          className="mono text-xs text-accent hover:underline disabled:text-tan-3 disabled:no-underline text-left">
          {r.docNo}
        </button>
      </td>
      <td className="py-2 px-3 align-top text-sm text-tan">{r.title}</td>
      <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
      <td className="py-2 px-3 align-top">
        {agentNames.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {agentNames.map(a => {
              const c = chains.get(a);
              return (
                <button key={a} onClick={() => c && onNavigate(c.agentId)}
                  className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors">
                  {a}
                </button>
              );
            })}
          </div>
        ) : null}
      </td>
      <td className="py-2 px-3 align-top">
        {facilitators.map(c => (
          <div key={c.facilitatorId} className="flex items-center gap-1.5 mb-0.5">
            <button onClick={() => onNavigate(c.executorId)}
              className="mono text-[10px] text-tan-3 hover:text-tan hover:underline">{c.executorName}</button>
            <span className="text-tan-3 text-[10px]">/</span>
            <button onClick={() => onNavigate(c.facilitatorId)}
              className="text-xs text-accent hover:underline">{c.facilitatorName}</button>
          </div>
        ))}
      </td>
    </tr>
  );
}

export function OFReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const chains = useAgentChains();
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [facilitatorFilter, setFacilitatorFilter] = useState<string | null>(null);

  const allAgents = useMemo(() => [...new Set(
    OF_RESPONSIBILITIES.flatMap(r => r.agents ?? (r.agent ? [r.agent] : []))
  )], []);

  const facilitators = useMemo(() => {
    const seen = new Map<string, { name: string; executorName: string }>();
    for (const [, c] of chains) {
      if (!seen.has(c.facilitatorId)) {
        seen.set(c.facilitatorId, { name: c.facilitatorName, executorName: c.executorName });
      }
    }
    return [...seen.entries()].map(([id, v]) => ({ id, ...v }));
  }, [chains]);

  const filtered = OF_RESPONSIBILITIES.filter(r => {
    const agentNames = r.agents ?? (r.agent ? [r.agent] : []);
    if (agentFilter && !agentNames.includes(agentFilter)) return false;
    if (facilitatorFilter) {
      const match = agentNames.some(a => chains.get(a)?.facilitatorName === facilitatorFilter);
      if (!match) return false;
    }
    return true;
  });

  const byCategory = Object.groupBy(filtered, r => r.category) as Record<OFResponsibility['category'], OFResponsibility[]>;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--tan)' }}>Operational Facilitator Responsibilities</h1>
        <p className="text-sm text-tan-3 mb-5">
          Every Atlas section mandating action from an Operational Facilitator.{" "}
          <button className="text-accent hover:underline" onClick={() => onNavigate("1ce24b08-84ff-4524-9710-49bba429c6ef")}>A.1.6 Facilitators ↗</button>
        </p>

        <div className="flex flex-wrap gap-4 mb-6">
          {facilitators.length > 0 && (
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-tan-3 mr-1">Facilitator:</span>
              {facilitators.map(f => (
                <button key={f.id}
                  onClick={() => setFacilitatorFilter(facilitatorFilter === f.name ? null : f.name)}
                  data-active={facilitatorFilter === f.name ? "true" : undefined}
                  className="scope-pill text-xs px-2 py-0.5 rounded">
                  {f.executorName} / {f.name}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Agent:</span>
            {allAgents.map(a => (
              <button key={a} onClick={() => setAgentFilter(agentFilter === a ? null : a)}
                data-active={agentFilter === a ? "true" : undefined}
                className="scope-pill mono text-xs px-2 py-0.5 rounded">{a}</button>
            ))}
          </div>
        </div>

        {(Object.entries(CATEGORY_LABELS) as [OFResponsibility['category'], string][]).map(([cat, label]) => {
          const rows = byCategory[cat];
          if (!rows?.length) return null;
          return (
            <div key={cat} className="mb-8">
              <h2 className="text-xs mono text-tan-3 uppercase tracking-wider mb-3 pb-1 border-b border-[var(--border)]">{label}</h2>
              <table className="w-full text-left">
                <thead>
                  <tr className="text-xs mono text-tan-3">
                    <th className="py-1 px-3 font-normal w-44">Doc</th>
                    <th className="py-1 px-3 font-normal">Section</th>
                    <th className="py-1 px-3 font-normal">Duty</th>
                    <th className="py-1 px-3 font-normal w-36">Agent</th>
                    <th className="py-1 px-3 font-normal w-48">OEA / Facilitator</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => <Row key={r.docNo} r={r} chains={chains} onNavigate={onNavigate} />)}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
