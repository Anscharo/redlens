import { CHANGE_COLOR, type HistoryEntry } from "../../lib/history";
import { DiffView } from "./DiffView";

const CHANGE_LABEL: Record<string, string> = {
  added: "added",
  modified: "edited",
  removed: "removed",
  moved: "moved",
};

export function EntryRow({ entry }: { entry: HistoryEntry }) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;

  return (
    <div className="border-b py-2.5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-1.5">
        <span style={{ color: "var(--tan-3)" }}>{entry.date}</span>
        <span style={{ color }}>{CHANGE_LABEL[entry.changeType]}</span>

        {/* per-change provenance for HTML-era entries: only the exceptions (AI / human)
            are badged — deterministically-matched links carry no badge (the default). */}
        {entry.era === "html" && (entry.method === "ai" || entry.method === "human") && (
          <span
            title={entry.method === "ai" ? "Lineage resolved by an AI model" : "Lineage resolved by human review"}
            className="shrink-0 px-1 rounded text-[9px] uppercase tracking-wide"
            style={{
              background: entry.method === "ai" ? "var(--accent)" : "var(--hover)",
              color: entry.method === "ai" ? "var(--bg)" : "var(--tan-2)",
            }}
          >
            {entry.method === "ai" ? "AI" : "human"}
          </span>
        )}

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

      {entry.changeType === "moved" && entry.movedTo && (
        <div className="mono text-[10px] mt-1" style={{ color: "var(--tan-3)" }}>
          {entry.movedFrom && <span>{entry.movedFrom} </span>}
          <span style={{ color: "var(--tan)" }}>→ {entry.movedTo}</span>
        </div>
      )}
    </div>
  );
}
