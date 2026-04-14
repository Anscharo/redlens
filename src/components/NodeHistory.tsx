import { useEffect, useState } from "react";
import { loadHistory, type HistoryEntry, type DiffLine, type WordSegment } from "../lib/history";

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

const DIFF_LINE_BG: Record<string, string> = {
  "+": "color-mix(in srgb, var(--depth-6) 12%, transparent)",
  "-": "#4a1010",
  "=": "transparent",
};
const DIFF_LINE_COLOR: Record<string, string> = {
  "+": "var(--depth-6)",
  "-": "#e8d5d5",
  "=": "var(--tan-3)",
};
const DIFF_LINE_PREFIX: Record<string, string> = { "+": "+", "-": "−", "=": " " };

const WORD_ADDED_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--depth-6) 30%, transparent)",
  color: "var(--depth-6)",
  borderRadius: 2,
};
const WORD_REMOVED_STYLE: React.CSSProperties = {
  background: "#4a1010",
  color: "#e8d5d5",
  borderRadius: 2,
  textDecoration: "line-through",
};

function IntralineDiff({ segments }: { segments: WordSegment[] }) {
  return (
    <span className="whitespace-pre-wrap break-all">
      {segments.map((seg, i) => {
        const [op, text] = seg;
        if (op === "+") return <span key={i} style={WORD_ADDED_STYLE}>{text}</span>;
        if (op === "-") return <span key={i} style={WORD_REMOVED_STYLE}>{text}</span>;
        return <span key={i} style={{ color: "var(--tan-2)" }}>{text}</span>;
      })}
    </span>
  );
}

function DiffView({ lines }: { lines: DiffLine[] }) {
  return (
    <div
      className="mt-2 rounded overflow-x-auto mono text-[10px] leading-relaxed"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      {lines.map((line, i) => {
        const op = line[0];

        if (op === "…") {
          return (
            <div key={i} className="px-2 py-0.5 select-none" style={{ color: "var(--tan-3)" }}>···</div>
          );
        }

        if (op === "~") {
          const segments = line[1] as WordSegment[];
          return (
            <div
              key={i}
              className="flex gap-1.5 px-2 py-0.5"
              style={{ background: "color-mix(in srgb, var(--accent) 6%, transparent)" }}
            >
              <span className="shrink-0 select-none w-3 text-center" style={{ color: "var(--tan-3)" }}>~</span>
              <IntralineDiff segments={segments} />
            </div>
          );
        }

        const text = line[1] as string;
        return (
          <div
            key={i}
            className="flex gap-1.5 px-2 py-0.5 whitespace-pre-wrap break-all"
            style={{ background: DIFF_LINE_BG[op] }}
          >
            <span className="shrink-0 select-none w-3 text-center" style={{ color: DIFF_LINE_COLOR[op] }}>
              {DIFF_LINE_PREFIX[op]}
            </span>
            <span style={{ color: op === "=" ? "var(--tan-2)" : DIFF_LINE_COLOR[op] }}>{text || "\u00a0"}</span>
          </div>
        );
      })}
    </div>
  );
}

function EntryRow({ entry }: { entry: HistoryEntry }) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;

  return (
    <div className="border-b py-2.5" style={{ borderColor: "var(--border)" }}>
      {/* Top row: date · type · title · meta · link */}
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-1.5">
        <span style={{ color: "var(--tan-3)" }}>{entry.date}</span>
        <span style={{ color }}>{CHANGE_LABEL[entry.changeType]}</span>

        {entry.summary ? (
          <span className="font-medium" style={{ color: "var(--tan)", fontFamily: "inherit" }}>
            {entry.summary}
          </span>
        ) : hasPr ? (
          <span style={{ color: "var(--tan)" }}>{entry.prTitle}</span>
        ) : null}

        {hasPr && entry.prAuthor && (
          <span style={{ color: "var(--tan-3)" }}>by {entry.prAuthor}</span>
        )}
        {hasPr && entry.approvalCount ? (
          <span style={{ color: "var(--tan-3)" }}>✓ {entry.approvalCount}</span>
        ) : null}
        {hasPr && entry.commentCount ? (
          <span style={{ color: "var(--tan-3)" }}>{entry.commentCount} comments</span>
        ) : null}

        {hasPr && (
          <a
            href={entry.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline focus-visible:underline"
            style={{ color: "var(--accent)" }}
          >
            #{entry.pr}
          </a>
        )}

        <a
          href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${entry.commitHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline focus-visible:underline"
          style={{ color: "var(--tan-3)" }}
        >
          {entry.commitHash}
        </a>
      </div>

      {/* Diff — full width */}
      {entry.diff && <DiffView lines={entry.diff} />}
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
