import { useState, useMemo, useEffect } from "react";
import { loadDocs } from "../../lib/docs";
import { loadGraph } from "../../lib/graph";
import type { RelationEntity, RelationEdge } from "../../types";
import type { AtlasNode } from "../../types";

const AGENT_PREFIXES: Array<[string, string]> = [
  ["A.6.1.1.1.", "Spark"],
  ["A.6.1.1.2.", "Grove"],
  ["A.6.1.1.3.", "Keel"],
  ["A.6.1.1.4.", "Skybase"],
  ["A.6.1.1.5.", "Obex"],
  ["A.6.1.1.6.", "Pattern"],
  ["A.6.1.1.7.", "Launch Agent 6"],
  ["A.6.1.1.8.", "Launch Agent 7"],
];

function agentFromDocNo(docNo: string): string | null {
  for (const [prefix, name] of AGENT_PREFIXES) {
    if (docNo.startsWith(prefix)) return name;
  }
  return null;
}

function extractProcess(content: string): "Direct Edit" | "Alignment Conserver Changes" {
  if (/alignment conserver/i.test(content)) return "Alignment Conserver Changes";
  return "Direct Edit";
}

interface AgentChain {
  agentName: string;
  agentId: string;
  executorName: string | null;
  executorId: string | null;
  facilitatorName: string | null;
  facilitatorId: string | null;
  govopsName: string | null;
  govopsId: string | null;
}

interface Row {
  controllerId: string;
  controllerDocNo: string;
  controllerTitle: string;
  entityName: string;
  entityId: string | null;
  entityType: string;
  process: "Direct Edit" | "Alignment Conserver Changes";
  agent: string | null;
  chain: AgentChain | null;
  activeDataDocs: AtlasNode[];
  sourceDocNo: string | null;
}

function buildChainMap(entities: RelationEntity[], edges: RelationEdge[]): Map<string, AgentChain> {
  const entityById = new Map(entities.map(e => [e.id, e]));
  const accords = edges.filter(e => e.e === "executor_accord");
  const memberOf = edges.filter(e => e.e === "member_of");
  const primes = entities.filter(e => e.et === "agent" && e.st === "prime");

  const map = new Map<string, AgentChain>();

  for (const prime of primes) {
    const accord = accords.find(e => e.f === prime.id);
    const executor = accord ? entityById.get(accord.t) : null;
    const members = executor ? memberOf.filter(e => e.t === executor.id) : [];

    const facEdge = members.find(e => {
      try { return (JSON.parse(e.m ?? "{}") as { role?: string }).role?.includes("facilitator"); } catch { return false; }
    });
    const govEdge = members.find(e => {
      try { return (JSON.parse(e.m ?? "{}") as { role?: string }).role === "govops"; } catch { return false; }
    });

    map.set(prime.name, {
      agentName: prime.name,
      agentId: prime.id,
      executorName: executor?.name?.replace(/^(Operational|Core Council) Executor Agent\s+/i, "") ?? null,
      executorId: executor?.id ?? null,
      facilitatorName: facEdge ? (entityById.get(facEdge.f)?.name ?? null) : null,
      facilitatorId: facEdge ? facEdge.f : null,
      govopsName: govEdge ? (entityById.get(govEdge.f)?.name ?? null) : null,
      govopsId: govEdge ? govEdge.f : null,
    });
  }

  return map;
}

function exportCSV(rows: Row[]) {
  const header = "Controller Doc,Title,Process,Agent,Executor Agent,Facilitator,GovOps,Responsible Party,Active Data\n";
  const body = rows.map(r =>
    `"${r.controllerDocNo}","${r.controllerTitle}","${r.process}","${r.agent ?? "Governance"}","${r.chain?.executorName ?? ""}","${r.chain?.facilitatorName ?? ""}","${r.chain?.govopsName ?? ""}","${r.entityName}","${r.activeDataDocs.map(d => d.doc_no).join("; ")}"`
  ).join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob),
    download: "active-data-index.csv",
  });
  a.click();
}


export function ActiveDataReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadDocs(), loadGraph()]).then(([docs, graph]) => {
      const { entities, edges } = graph;
      const entityById = new Map<string, RelationEntity>(entities.map(e => [e.id, e]));
      const chainMap = buildChainMap(entities, edges);
      const allDocValues = Object.values(docs);

      const rfEdges = edges.filter((e: RelationEdge) => e.e === "responsible_for");

      const built: Row[] = rfEdges.flatMap((e: RelationEdge) => {
        const entity = entityById.get(e.f);
        const controllerDoc = docs[e.t];
        if (!controllerDoc) return [];

        const prefix = controllerDoc.doc_no + ".0.6.";
        const activeDataDocs = allDocValues
          .filter(d => d.doc_no.startsWith(prefix))
          .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));

        const agent = agentFromDocNo(controllerDoc.doc_no);

        const row: Row = {
          controllerId: e.t,
          controllerDocNo: controllerDoc.doc_no,
          controllerTitle: controllerDoc.title,
          entityName: entity?.name ?? "Unknown",
          entityId: e.f,
          entityType: entity?.et ?? "unknown",
          process: extractProcess(controllerDoc.content),
          agent,
          chain: agent ? (chainMap.get(agent) ?? null) : null,
          activeDataDocs,
          sourceDocNo: e.s?.[0] ?? null,
        };
        return [row];
      }).sort((a, b) => a.controllerDocNo.localeCompare(b.controllerDocNo, undefined, { numeric: true }));

      setRows(built);
    });
  }, []);

  const agents = useMemo(() => {
    const set = new Set(rows.map(r => r.agent ?? "Governance"));
    return ["Governance", ...AGENT_PREFIXES.map(([, name]) => name)].filter(a => set.has(a));
  }, [rows]);

  // Generic role strings that aren't specific named entities — exclude from filter
  const ROLE_NAMES = new Set([
    "Operational Facilitator", "Core Facilitator",
    "Operational GovOps", "Core GovOps",
    "Support Facilitators", "Unknown",
  ]);

  // All unique editors: responsible party + facilitator + govops names (named entities only)
  const entityNames = useMemo(() => {
    const names = new Set<string>();
    rows.forEach(r => {
      if (!ROLE_NAMES.has(r.entityName)) names.add(r.entityName);
      if (r.chain?.executorName) names.add(r.chain.executorName);
      if (r.chain?.facilitatorName) names.add(r.chain.facilitatorName);
      if (r.chain?.govopsName) names.add(r.chain.govopsName);
    });
    return [...names].sort();
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (agentFilter === "Governance" && r.agent !== null) return false;
    if (agentFilter && agentFilter !== "Governance" && r.agent !== agentFilter) return false;
    if (entityFilter) {
      const match =
        r.entityName === entityFilter ||
        r.chain?.executorName === entityFilter ||
        r.chain?.facilitatorName === entityFilter ||
        r.chain?.govopsName === entityFilter;
      if (!match) return false;
    }
    return true;
  }), [rows, agentFilter, entityFilter]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: "var(--tan)" }}>Active Data Index</h1>
        <p className="text-sm text-tan-3 mb-5">
          All Active Data sections with full responsibility chain — sourced from the Atlas graph.{" "}
          <button className="text-accent hover:underline" onClick={() => onNavigate("75e8fd51-a540-4c3a-aaa9-1a38502f89b2")}>
            A.1.12 ↗
          </button>
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs text-tan-3">Scope:</span>
          {agents.map(a => (
            <button key={a} onClick={() => setAgentFilter(agentFilter === a ? null : a)}
              data-active={agentFilter === a ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded">{a}</button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6">
          <span className="text-xs text-tan-3">Editor:</span>
          {entityNames.map(e => (
            <button key={e} onClick={() => setEntityFilter(entityFilter === e ? null : e)}
              data-active={entityFilter === e ? "true" : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded">{e}</button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-tan-3">{filtered.length} sections</p>
          <button onClick={() => exportCSV(filtered)}
            className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors">
            Download CSV
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: "960px" }}>
            <thead>
              <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
                <th className="py-2 px-3 font-normal w-40">Controller</th>
                <th className="py-2 px-3 font-normal">Doc</th>
                <th className="py-2 px-3 font-normal w-36">Role</th>
                <th className="py-2 px-3 font-normal w-24">Agent</th>
                <th className="py-2 px-3 font-normal w-36">OEA</th>
                <th className="py-2 px-3 font-normal w-36">Facilitator</th>
                <th className="py-2 px-3 font-normal w-36">GovOps</th>
                <th className="py-2 px-3 font-normal w-32">Process</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.controllerId} className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                  <td className="py-2 px-3 align-top">
                    <button onClick={() => onNavigate(r.controllerId)}
                      className="mono text-xs text-accent hover:underline text-left">
                      {r.controllerDocNo}
                    </button>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.activeDataDocs[0] ? (
                      <button onClick={() => onNavigate(r.activeDataDocs[0].id)}
                        className="text-sm text-tan hover:underline text-left">
                        {r.activeDataDocs[0].title}
                      </button>
                    ) : (
                      <span className="text-sm text-tan-3">{r.controllerTitle}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="text-xs text-tan-3">{r.entityName}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.agent ?? "—"}</span>
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.chain?.executorName ? (
                      <button onClick={() => r.chain?.executorId && onNavigate(r.chain.executorId)}
                        className="text-xs text-tan-2 hover:text-tan hover:underline text-left">
                        {r.chain.executorName}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.chain?.facilitatorName ? (
                      <button onClick={() => r.chain?.facilitatorId && onNavigate(r.chain.facilitatorId)}
                        className="text-xs text-tan-2 hover:text-tan hover:underline text-left">
                        {r.chain.facilitatorName}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    {r.chain?.govopsName ? (
                      <button onClick={() => r.chain?.govopsId && onNavigate(r.chain.govopsId)}
                        className="text-xs text-tan-2 hover:text-tan hover:underline text-left">
                        {r.chain.govopsName}
                      </button>
                    ) : <span className="mono text-[10px] text-tan-3">—</span>}
                  </td>
                  <td className="py-2 px-3 align-top">
                    <span className="mono text-xs text-tan-3">{r.process}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
