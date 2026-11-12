import {
  CHANGE_COLOR,
  RECONSTRUCTED_ERAS,
  isGitSha,
  severedRange,
  type HistoryEntry,
} from "@/lib/history";
import { DiffView } from "./DiffView";
import { ChangeLabel } from "./ChangeLabel";
import { EntryCommitLink, EntryCommitTag } from "./EntryCommit";
import { EntryPrLink } from "./EntryPrLink";
import { EntrySourceLink } from "./EntrySourceLink";
import { EntryTitle } from "./EntryTitle";
import { EntryDate, EntryRange } from "./EntryWhen";
import { LINE1_H, TimelineRow } from "./Timeline";
import { Tooltip } from "../Tooltip";
import { HtmlEraDisclaimer, PreGitDisclaimer } from "./HistoryDisclaimers";

// Small info affordance next to a reconstructed entry's date — hovering/focusing
// it reveals the provenance tooltip (see HistoryDisclaimers).
function InfoIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="8" r="1.4" fill="currentColor" />
      <path d="M12 11.5v5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

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
  const color = CHANGE_COLOR[entry.changeType];
  const pr = entry.pr;
  const gitSha = isGitSha(entry.commitHash);
  const hideChangeLabel =
    !labelOverride && entry.changeType === "added" && !!entry.era && PRE_GIT_ADDED_ERAS.has(entry.era);

  const title = entry.summary ?? (pr ? entry.prTitle : undefined);
  const range = entry.date ? null : severedRange(entry.commitHash);

  return (
    // Each entry is one node on the timeline: the rail runs down the left gutter,
    // the unit's three lines (date + PR/commit, title, type of edit) sit to its right.
    <article>
      <TimelineRow dot={color} hideTop={isFirst}>
        {/* Line 1 is the entry's heading: date, then the Atlas PR (if any) or —
            only when there's no PR — the commit / reconstructed source. LINE1_H
            keeps the timeline dot centered on it — see Timeline.tsx. */}
        <h4
          className="flex items-baseline gap-2 flex-wrap mono text-[13px]"
          style={{ lineHeight: `${LINE1_H}px` }}
        >
          {entry.date ? <EntryDate date={entry.date} /> : range ? <EntryRange range={range} /> : null}

          {/* Reconstructed / pre-git entries flag their provenance with an info
              icon by the date; its tooltip carries the disclaimer + learn-more link. */}
          {entry.era && RECONSTRUCTED_ERAS.has(entry.era) && (
            <Tooltip content={entry.era === "html" ? <HtmlEraDisclaimer /> : <PreGitDisclaimer />}>
              <span
                tabIndex={0}
                role="note"
                aria-label={entry.era === "html" ? "This history is reconstructed" : "This history comes from pre-git sources"}
                className="shrink-0 inline-flex items-center cursor-help"
                style={{ color: "var(--tan-3)" }}
              >
                <InfoIcon />
              </span>
            </Tooltip>
          )}

          {pr ? (
            <EntryPrLink pr={pr} prUrl={entry.prUrl} />
          ) : gitSha ? (
            <EntryCommitLink hash={entry.commitHash} />
          ) : entry.sourceUrl ? (
            <EntrySourceLink href={entry.sourceUrl} />
          ) : range ? null : (
            <EntryCommitTag hash={entry.commitHash} />
          )}

          {/* per-change provenance for reconstructed entries: only the exceptions (AI / human)
              are badged — deterministically-matched links carry no badge (the default). */}
          {entry.era && RECONSTRUCTED_ERAS.has(entry.era) && (entry.method === "ai" || entry.method === "human") && (
            <span
              title={entry.method === "ai" ? "Lineage resolved by an AI model" : "Lineage resolved by human review"}
              className="shrink-0 px-1 rounded text-[10px] uppercase tracking-wide"
              style={{
                background: entry.method === "ai" ? "var(--accent)" : "var(--hover)",
                color: entry.method === "ai" ? "var(--bg)" : "var(--tan-2)",
                lineHeight: `${LINE1_H}px`,
              }}
            >
              {entry.method === "ai" ? "AI" : "human"}
            </span>
          )}
        </h4>

        {title ? <EntryTitle text={title} /> : null}

        {/* Line 3: the type of edit. */}
        {!hideChangeLabel && <ChangeLabel entry={entry} label={labelOverride} />}

        {entry.diff && <DiffView lines={entry.diff} />}
      </TimelineRow>
    </article>
  );
}
