import { useState, useEffect } from "react";
import { loadHistory, type HistoryEntry, type DiffLine } from "../lib/history";

const CHANGE_COLOR: Record<string, string> = {
  added:    "var(--depth-6)",
  modified: "var(--tan-3)",
  removed:  "var(--red)",
};

const CHANGE_LABEL: Record<string, string> = {
  added:    "added",
  modified: "edited",
  removed:  "removed",
};

function EntryRow({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false);
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;
  const hasDetail = !!(entry.description || (hasPr && (entry.reviewCount || entry.commentCount)));

  return (
    <div className="border-b py-3" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-start gap-3">
        {/* Date + change type */}
        <div className="shrink-0 text-right" style={{ minWidth: "5.5rem" }}>
          <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>{entry.date}</span>
          <br />
          <span className="mono text-[9px]" style={{ color }}>{CHANGE_LABEL[entry.changeType]}</span>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {entry.summary ? (
            <p className="text-xs font-medium leading-snug mb-0.5" style={{ color: "var(--tan)" }}>
              {entry.summary}
            </p>
          ) : null}

          {hasPr ? (
            <a
              href={entry.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-[10px] hover:underline focus-visible:underline"
              style={{ color: "var(--accent)" }}
            >
              {entry.prTitle ?? `PR #${entry.pr}`}
            </a>
          ) : (
            <span className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>{entry.commitHash}</span>
          )}

          {/* Expand toggle for description + review metadata */}
          {hasDetail && (
            <button
              className="block mt-1 mono text-[9px]"
              style={{ color: "var(--tan-3)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
              onClick={() => setOpen(o => !o)}
            >
              {open ? "▴ less" : "▾ more"}
            </button>
          )}

          {open && (
            <div className="mt-2 space-y-1.5">
              {entry.description && (
                <p className="text-xs leading-relaxed" style={{ color: "var(--tan-2)" }}>
                  {entry.description}
                </p>
              )}
              {hasPr && (entry.reviewCount || entry.commentCount) ? (
                <div className="flex gap-3 mono text-[9px]" style={{ color: "var(--tan-3)" }}>
                  {entry.reviewCount ? (
                    <span>
                      {entry.approvalCount ?? 0}/{entry.reviewCount} approved
                    </span>
                  ) : null}
                  {entry.commentCount ? <span>{entry.commentCount} comments</span> : null}
                  {entry.prAuthor ? <span>by {entry.prAuthor}</span> : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

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

  // Show newest first
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      {sorted.map((entry, i) => (
        <EntryRow key={i} entry={entry} />
      ))}
    </div>
  );
}
