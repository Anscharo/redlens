import type { ReportId } from "../App";

const REPORTS: { id: ReportId; title: string; description: string }[] = [
  { id: "of-responsibilities", title: "Operational Facilitator Responsibilities", description: "Every Atlas section mandating action from an Operational Facilitator, grouped by duty type with per-agent filtering." },
  { id: "active-data",         title: "Active Data Index",                        description: "All Active Data sections, their Responsible Parties, edit processes, and agent assignments — with CSV export." },
];

export function ReportsIndex({ onNavigate }: { onNavigate: (id: ReportId) => void }) {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-2xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">reports</p>
        <h1 className="text-xl font-semibold mb-6" style={{ color: 'var(--tan)' }}>Reports</h1>
        <div className="space-y-3">
          {REPORTS.map(r => (
            <button key={r.id} onClick={() => onNavigate(r.id)}
              className="w-full text-left px-4 py-4 rounded border transition-colors hover:bg-[var(--hover)]"
              style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--tan)' }}>{r.title}</p>
              <p className="text-xs" style={{ color: 'var(--tan-3)' }}>{r.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
