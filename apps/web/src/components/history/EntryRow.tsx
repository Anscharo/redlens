import {
  ATLAS_REPO,
  CHANGE_COLOR,
  RECONSTRUCTED_ERAS,
  isGitSha,
  movePaths,
  prHref,
  severedRange,
  type HistoryEntry,
} from "@/lib/history";
import { DiffView } from "./DiffView";
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
  const move = movePaths(entry);
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
          {/* A severed-era birth has no date, only the window it happened in —
              shown as a month range (not a <time>, which can't express one). */}
          {entry.date ? (
            <time dateTime={entry.date} style={{ color: "var(--tan-3)" }}>
              {entry.date}
            </time>
          ) : range ? (
            <span style={{ color: "var(--tan-3)" }}>{range}</span>
          ) : null}

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

          {hasPr ? (
            <a
              href={prHref(entry)}
              target="_blank"
              rel="noopener noreferrer"
              title={`Atlas Pull Request #${entry.pr}`}
              className="hover:underline focus-visible:underline"
              style={{ color: "var(--accent)" }}
            >
              PR {entry.pr}
            </a>
          ) : gitSha ? (
            <span style={{ color: "var(--tan-3)" }}>
              commit{" "}
              <a
                href={`${ATLAS_REPO}/commit/${entry.commitHash}`}
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
              source <span className="enlargen">→</span>
            </a>
          ) : range ? null : (
            // No real sha and no external source to link. A severed-era birth is
            // already covered by the range above; anything else shows its tag.
            <span style={{ color: "var(--tan-3)" }}>{entry.commitHash}</span>
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

        {/* Line 2: the change's title. */}
        {title ? (
          <p className="italic text-[12px] leading-snug mt-1" style={{ color: "var(--tan)" }}>
            {title}
          </p>
        ) : null}

        {/* Line 3: the type of edit — a move reads as one sentence, folding its
            from/to paths into the label rather than a separate arrow line. */}
        {!hideChangeLabel && (
          <p className="mono text-[12px] mt-1 break-all" style={{ color }}>
            {labelOverride ?? CHANGE_LABEL[entry.changeType]}
            {move && (
              <>
                {move.from && (
                  <>
                    {" from "}
                    <span style={{ color: "var(--tan-3)" }}>{move.from}</span>
                  </>
                )}
                {" to "}
                <span style={{ color: "var(--tan-2)" }}>{move.to}</span>
              </>
            )}
          </p>
        )}

        {entry.diff && <DiffView lines={entry.diff} />}
      </TimelineRow>
    </article>
  );
}
