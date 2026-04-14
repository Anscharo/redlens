// ---------------------------------------------------------------------------
// Dev shortcuts — type __dev <cmd> in the search box
// ---------------------------------------------------------------------------
const DEV_SHORTCUTS = [
  {
    cmd: "deep",
    label: "Deepest node",
    hint: "A.6.1.1.1.2.6.1.2.2.1.2.1.2.1.1.3.1 · Encode Mint Function Call",
    id: "c7b2c565-d1b5-4239-9139-89762423443d",
  },
  {
    cmd: "notes",
    label: "Most annotated node",
    hint: "A.1.9.5.2.3.1 · The Core Facilitator Role In Standby Spells · 5 linked nodes",
    id: "50d68397-c09d-4f82-9e8b-44c2bcc30fd7",
  },
  {
    cmd: "history",
    label: "Most-edited node",
    hint: "A.1.5.1.5.0.6.1 · Current Aligned Delegates · 7 changes",
    id: "5f584db8-f8d8-4118-988c-b2bc3f68ceb7",
  },
];
export function DevPanel({ query, onNavigate }: { query: string; onNavigate: (id: string) => void; }) {
  const lower = query.slice("__dev".length).trim().toLowerCase();
  const matches = lower
    ? DEV_SHORTCUTS.filter(s => s.cmd.startsWith(lower))
    : DEV_SHORTCUTS;

  if (matches.length === 0) return null;

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <p className="mono text-[10px] mb-4 text-tan-3">dev shortcuts</p>
      <div className="space-y-1">
        {matches.map(s => (
          <button
            key={s.cmd}
            onClick={() => onNavigate(s.id)}
            className="hint-row w-full text-left px-3 py-2 rounded flex items-baseline gap-4"
          >
            <span className="mono text-xs shrink-0 w-20 text-accent">__{s.cmd}</span>
            <span className="text-xs font-medium shrink-0 text-tan">{s.label}</span>
            <span className="mono text-[10px] truncate text-tan-3">{s.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
