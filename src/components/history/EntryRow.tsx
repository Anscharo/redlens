import type { HistoryEntry } from "../../lib/history";
import { DiffView } from "./DiffView";

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

export function EntryRow({ entry }: { entry: HistoryEntry }) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;

  return (
    <div className="border-b py-2.5" style={{ borderColor: "var(--border)" }}>
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

      {entry.diff && <DiffView lines={entry.diff} />}
    </div>
  );
}
