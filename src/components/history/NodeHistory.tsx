import { useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import { EntryRow } from "./EntryRow";

export function NodeHistory({ nodeId }: { nodeId: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(undefined as unknown as null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setEntries(null);
    loadHistory(nodeId).then(data => {
      setEntries(data);
      setLoading(false);
    });
  }, [nodeId]);

  if (loading) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        loading history…
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        no history recorded
      </p>
    );
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      {sorted.map((entry, i) => (
        <EntryRow key={i} entry={entry} />
      ))}
    </div>
  );
}
