import { CHANGE_COLOR, RECONSTRUCTED_ERAS, isGitSha, type HistoryEntry } from "../../lib/history";
import { DiffView } from "./DiffView";

const CHANGE_LABEL: Record<string, string> = {
  added: "added",
  modified: "edited",
  removed: "removed",
  moved: "moved",
};

interface Props {
  entry: HistoryEntry;
  /** Override the change-type label text for this one row — used by NodeHistory to
   *  relabel the root html-snapshot "added" event "first git snapshot" when older
   *  reconstructed origin events exist below it (docs/plans/pre-git-history.md). */
  labelOverride?: string;
}

// Pre-git origin events (docs/plans/pre-git-history.md) carry a self-descriptive
// summary ("Proposed in MIP101 §5", "Present at Atlas v2 genesis") — a redundant
// "added" chip next to that text adds noise, not information.
const PRE_GIT_ADDED_ERAS = new Set(["mip", "genesis", "severed"]);

export function EntryRow({ entry, labelOverride }: Props) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;
  const gitSha = isGitSha(entry.commitHash);
  const hideChangeLabel =
    !labelOverride && entry.changeType === "added" && !!entry.era && PRE_GIT_ADDED_ERAS.has(entry.era);

  return (
    <div className="border-b py-2.5" style={{ borderColor: "var(--border)" }}>
      <div className="flex items-baseline gap-2 flex-wrap mono text-[10px] mb-1.5">
        <span style={{ color: "var(--tan-3)" }}>{entry.date}</span>
        {!hideChangeLabel && (
          <span style={{ color }}>{labelOverride ?? CHANGE_LABEL[entry.changeType]}</span>
        )}

        {/* per-change provenance for reconstructed entries: only the exceptions (AI / human)
            are badged — deterministically-matched links carry no badge (the default). */}
        {entry.era && RECONSTRUCTED_ERAS.has(entry.era) && (entry.method === "ai" || entry.method === "human") && (
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

        {gitSha ? (
          <a
            href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${entry.commitHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline focus-visible:underline"
            style={{ color: "var(--tan-3)" }}
          >
            {entry.commitHash}
          </a>
        ) : entry.sourceUrl ? (
          // Reconstructed pre-git origin (era mip/genesis): a synthetic tag, not a
          // commit — link the external source (mips-repo section / genesis snapshot)
          // instead of a dead github.com/.../commit/ URL.
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline focus-visible:underline"
            style={{ color: "var(--tan-3)" }}
          >
            source →
          </a>
        ) : (
          <span style={{ color: "var(--tan-3)" }}>{entry.commitHash}</span>
        )}
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
