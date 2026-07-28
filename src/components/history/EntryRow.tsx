import { CHANGE_COLOR, RECONSTRUCTED_ERAS, isGitSha, type HistoryEntry } from "../../lib/history";
import { DiffView } from "./DiffView";
import { TimelineRail } from "./Timeline";

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
  /** Newest (topmost) entry — trims the timeline line above its node. */
  isFirst?: boolean;
}

// Pre-git origin events (docs/plans/pre-git-history.md) carry a self-descriptive
// summary ("Proposed in MIP101 §5", "Present at Atlas v2 genesis") — a redundant
// "added" chip next to that text adds noise, not information.
const PRE_GIT_ADDED_ERAS = new Set(["mip", "genesis", "severed"]);

export function EntryRow({ entry, labelOverride, isFirst }: Props) {
  const color = CHANGE_COLOR[entry.changeType] ?? "var(--tan-3)";
  const hasPr = !!entry.pr;
  const gitSha = isGitSha(entry.commitHash);
  const hideChangeLabel =
    !labelOverride && entry.changeType === "added" && !!entry.era && PRE_GIT_ADDED_ERAS.has(entry.era);

  // Title of the unit (line 2): the matched PR-body bullet, else the PR title.
  const title = entry.summary ?? (hasPr ? entry.prTitle : undefined);

  return (
    // Each entry is one node on the timeline: the rail runs down the left gutter,
    // the unit's three lines (date + PR/commit, title, type of edit) sit to its right.
    <article className="border-b" style={{ borderColor: "var(--border)" }}>
      <div className="flex gap-3 py-2.5">
        <TimelineRail color={color} hideTop={isFirst} />
        <div className="min-w-0 flex-1">
      {/* Line 1: date, then the Atlas PR (if any) or — only when there's no PR —
          the commit / reconstructed source. */}
      <div className="flex items-baseline gap-2 flex-wrap mono text-[11px]">
        <span style={{ color: "var(--tan-3)" }}>{entry.date}</span>

        {hasPr ? (
          <span style={{ color: "var(--tan-2)" }}>
            Atlas Pull Request{" "}
            <a
              href={entry.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline focus-visible:underline"
              style={{ color: "var(--accent)" }}
            >
              #{entry.pr}
            </a>
          </span>
        ) : gitSha ? (
          <span style={{ color: "var(--tan-3)" }}>
            Commit{" "}
            <a
              href={`https://github.com/sky-ecosystem/next-gen-atlas/commit/${entry.commitHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline focus-visible:underline"
              style={{ color: "var(--tan-3)" }}
            >
              {entry.commitHash}
            </a>
          </span>
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
          // Undated severed-era birth: no real sha, no external source to link —
          // show a human label instead of the raw internal `severed:<window>` tag.
          <span style={{ color: "var(--tan-3)" }}>
            {entry.era === "severed" ? "undated" : entry.commitHash}
          </span>
        )}

        {hasPr && entry.prAuthor && (
          <span style={{ color: "var(--tan-3)" }}>by {entry.prAuthor}</span>
        )}
        {hasPr && entry.commentCount ? (
          <span style={{ color: "var(--tan-3)" }}>{entry.commentCount} comments</span>
        ) : null}

        {/* per-change provenance for reconstructed entries: only the exceptions (AI / human)
            are badged — deterministically-matched links carry no badge (the default). */}
        {entry.era && RECONSTRUCTED_ERAS.has(entry.era) && (entry.method === "ai" || entry.method === "human") && (
          <span
            title={entry.method === "ai" ? "Lineage resolved by an AI model" : "Lineage resolved by human review"}
            className="shrink-0 px-1 rounded text-[10px] uppercase tracking-wide"
            style={{
              background: entry.method === "ai" ? "var(--accent)" : "var(--hover)",
              color: entry.method === "ai" ? "var(--bg)" : "var(--tan-2)",
            }}
          >
            {entry.method === "ai" ? "AI" : "human"}
          </span>
        )}
      </div>

      {/* Line 2: the change's title. */}
      {title ? (
        <div className="font-medium text-[13px] mt-1" style={{ color: "var(--tan)" }}>
          {title}
        </div>
      ) : null}

      {/* Line 3: the type of edit. */}
      {!hideChangeLabel && (
        <div className="mono text-[11px] mt-1" style={{ color }}>
          {labelOverride ?? CHANGE_LABEL[entry.changeType]}
        </div>
      )}

      {entry.diff && <DiffView lines={entry.diff} />}

      {/* A move renders its destination prominently (larger, not a faint arrow). */}
      {entry.changeType === "moved" && entry.movedTo && (
        <div className="mono text-[13px] mt-1.5" style={{ color: "var(--tan-2)" }}>
          {entry.movedFrom && <span style={{ color: "var(--tan-3)" }}>{entry.movedFrom} </span>}
          <span style={{ color: "var(--tan)" }}>→ {entry.movedTo}</span>
        </div>
      )}
        </div>
      </div>
    </article>
  );
}
