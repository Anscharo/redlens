import { useState } from "react";
import { OF_RESPONSIBILITIES, AGENTS, AGENT_META, CATEGORY_LABELS, type OFResponsibility } from "../../data/precalculated/ofResponsibilities";

const BASE = import.meta.env.BASE_URL;

function NodeLink({ docNo, uuid, children }: { docNo: string; uuid: string; children: React.ReactNode }) {
  if (!uuid) return <span className="mono text-xs text-tan-3">{children}</span>;
  return (
    <a href={`/atlas?id=${uuid}`} className="mono text-xs text-accent hover:underline" title={docNo}>
      {children}
    </a>
  );
}

function AgentPill({ name }: { name: string }) {
  const meta = AGENT_META[name];
  return (
    <span className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)]"
      style={{ color: 'var(--tan-3)' }}
      title={meta ? `${meta.executorAgent} · ${meta.operationalFacilitator}` : name}>
      {name}
    </span>
  );
}

function Row({ r, onNavigate }: { r: OFResponsibility; onNavigate: (id: string) => void }) {
  const agentCell = r.agents
    ? <div className="flex flex-wrap gap-1">{r.agents.map(a => <AgentPill key={a} name={a} />)}</div>
    : r.agent ? <AgentPill name={r.agent} /> : null;

  // For single-agent rows, show the actual OF name
  const ofName = r.agent ? AGENT_META[r.agent]?.operationalFacilitator : null;

  return (
    <tr className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
      <td className="py-2 px-3 align-top">
        <button onClick={() => r.uuid && onNavigate(r.uuid)} disabled={!r.uuid}
          className="mono text-xs text-accent hover:underline disabled:text-tan-3 disabled:no-underline text-left">
          {r.docNo}
        </button>
      </td>
      <td className="py-2 px-3 align-top text-sm">{r.title}</td>
      <td className="py-2 px-3 align-top text-sm text-tan-2">{r.duty}</td>
      <td className="py-2 px-3 align-top">{agentCell}</td>
      <td className="py-2 px-3 align-top">
        {ofName
          ? (() => {
              const meta = r.agent ? AGENT_META[r.agent] : null;
              return (
                <span className="text-xs" style={{ color: 'var(--accent)' }}>
                  {meta ? <span className="text-tan-3">{meta.executorAgent} / </span> : null}
                  {ofName}
                </span>
              );
            })()
          : r.agents
            ? <span className="text-xs text-tan-3">Amatsu+Ozone / Endgame+Redline</span>
            : null
        }
      </td>
    </tr>
  );
}

const FACILITATORS: { label: string; name: string; executorAgent: string }[] = [
  { label: 'Ozone / Redline Facilitation Group', name: 'Redline Facilitation Group', executorAgent: 'Ozone'  },
  { label: 'Amatsu / Endgame Edge',              name: 'Endgame Edge',               executorAgent: 'Amatsu' },
];

export function OFReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [facilitatorFilter, setFacilitatorFilter] = useState<string | null>(null);

  const filtered = OF_RESPONSIBILITIES.filter(r => {
    if (agentFilter) {
      if (r.agents) { if (!r.agents.includes(agentFilter)) return false; }
      else if (r.agent && r.agent !== agentFilter) return false;
    }
    if (facilitatorFilter) {
      const agents = r.agents ?? (r.agent ? [r.agent] : null);
      if (agents) {
        const match = agents.some(a => AGENT_META[a]?.operationalFacilitator === facilitatorFilter);
        if (!match) return false;
      }
    }
    return true;
  });

  const byCategory = Object.groupBy(filtered, r => r.category) as Record<OFResponsibility['category'], OFResponsibility[]>;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-5xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--tan)' }}>Operational Facilitator Responsibilities</h1>
        <p className="text-sm text-tan-3 mb-5">Every Atlas section mandating action from an Operational Facilitator. <NodeLink docNo="A.1.6" uuid="1ce24b08-84ff-4524-9710-49bba429c6ef">A.1.6 Facilitators ↗</NodeLink></p>

        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Facilitator:</span>
            {FACILITATORS.map(f => (
              <button key={f.name} onClick={() => setFacilitatorFilter(facilitatorFilter === f.name ? null : f.name)}
                data-active={facilitatorFilter === f.name ? 'true' : undefined}
                className="scope-pill text-xs px-2 py-0.5 rounded">{f.label}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Agent:</span>
            {AGENTS.map(a => (
              <button key={a} onClick={() => setAgentFilter(agentFilter === a ? null : a)}
                data-active={agentFilter === a ? 'true' : undefined}
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
                    <th className="py-1 px-3 font-normal w-44">Facilitator</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => <Row key={r.docNo} r={r} onNavigate={onNavigate} />)}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
