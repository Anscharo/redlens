import { useState, useMemo } from "react";
import { ACTIVE_DATA_INDEX, ALL_AGENTS, type ActiveDataEntry } from "../../data/precalculated/activeDataIndex";
import { AGENT_META } from "../../data/precalculated/ofResponsibilities";

const BASE = import.meta.env.BASE_URL;

const PARTY_COLORS: Record<string, string> = {
  'Core Facilitator':              'var(--red)',
  'Core GovOps':                   'var(--accent)',
  'Operational GovOps':            '#7a9e7e',
  'Operational GovOps Soter Labs': '#7a9e7e',
  'Redline Facilitation Group':    '#c4a35a',  // Ozone OF
  'Endgame Edge':                  '#b8860b',  // Amatsu OF
  'Support Facilitators':          'var(--tan-3)',
  'Viridian Advisors':             'var(--tan-3)',
};

function exportCSV(rows: ActiveDataEntry[]) {
  const header = 'Doc No,Title,Responsible Party,Process,Agent\n';
  const body = rows.map(r =>
    `"${r.controllerDocNo}","${r.title}","${r.responsibleParty}","${r.process}","${r.agent ?? 'Sky Core'}"`
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'active-data-index.csv' });
  a.click();
}

export function ActiveDataReport({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [partyFilter, setPartyFilter] = useState<string | null>(null);

  const rows = useMemo(() => ACTIVE_DATA_INDEX.filter(r => {
    if (agentFilter === 'Sky Core') return r.agent === null;
    if (agentFilter) return r.agent === agentFilter;
    return true;
  }).filter(r => !partyFilter || r.responsibleParty === partyFilter), [agentFilter, partyFilter]);

  const parties = useMemo(() => [...new Set(ACTIVE_DATA_INDEX.map(r => r.responsibleParty))], []);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-6xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">report</p>
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--tan)' }}>Active Data Index</h1>
        <p className="text-sm text-tan-3 mb-5">
          All Active Data sections, their Responsible Parties, and edit processes.{' '}
          <a href={`${BASE}?id=75e8fd51-a540-4c3a-aaa9-1a38502f89b2`} className="text-accent hover:underline">A.1.12 Updating Active Data ↗</a>
        </p>

        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-tan-3 mr-1">Agent:</span>
            {['Sky Core', ...ALL_AGENTS].map(a => (
              <button key={a} onClick={() => setAgentFilter(agentFilter === a ? null : a)}
                data-active={agentFilter === a ? 'true' : undefined}
                className="scope-pill mono text-xs px-2 py-0.5 rounded">{a}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center mb-6">
          <span className="text-xs text-tan-3 mr-1">Editor:</span>
          {parties.map(p => (
            <button key={p} onClick={() => setPartyFilter(partyFilter === p ? null : p)}
              data-active={partyFilter === p ? 'true' : undefined}
              className="scope-pill mono text-xs px-2 py-0.5 rounded">{p}</button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-tan-3">{rows.length} sections</p>
          <button onClick={() => exportCSV(rows)}
            className="mono text-xs px-3 py-1 rounded border border-[var(--border)] text-tan-3 hover:text-tan hover:border-[var(--accent)] transition-colors">
            Download CSV
          </button>
        </div>

        <table className="w-full text-left">
          <thead>
            <tr className="text-xs mono text-tan-3 border-b border-[var(--border)]">
              <th className="py-2 px-3 font-normal w-44">Doc</th>
              <th className="py-2 px-3 font-normal">Section</th>
              <th className="py-2 px-3 font-normal w-48">Responsible Party</th>
              <th className="py-2 px-3 font-normal w-40">Process</th>
              <th className="py-2 px-3 font-normal w-28">Agent</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.controllerDocNo} className="border-t border-[var(--border)] hover:bg-[var(--hover)] transition-colors">
                <td className="py-2 px-3 align-top">
                  <button onClick={() => r.controllerUuid && onNavigate(r.controllerUuid)}
                    disabled={!r.controllerUuid}
                    className="mono text-xs text-accent hover:underline disabled:text-tan-3 disabled:no-underline text-left">
                    {r.controllerDocNo}
                  </button>
                </td>
                <td className="py-2 px-3 align-top text-sm">
                  {r.title}
                  {r.note && <span className="ml-2 mono text-xs text-tan-3">({r.note})</span>}
                </td>
                <td className="py-2 px-3 align-top">
                  <span className="text-xs" style={{ color: PARTY_COLORS[r.responsibleParty] ?? 'var(--tan-3)' }}>
                    {r.responsibleParty}
                  </span>
                </td>
                <td className="py-2 px-3 align-top">
                  <span className="mono text-xs text-tan-3">{r.process}</span>
                </td>
                <td className="py-2 px-3 align-top">
                  {r.agent
                    ? (() => {
                        const meta = AGENT_META[r.agent];
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className="mono text-xs px-1.5 py-0.5 rounded bg-[var(--surface)] text-tan-3 border border-[var(--border)]">{r.agent}</span>
                            {meta && <span className="mono text-[10px] text-tan-3 opacity-60">via {meta.executorAgent}</span>}
                          </div>
                        );
                      })()
                    : <span className="mono text-xs text-tan-3">Sky Core</span>
                  }
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
