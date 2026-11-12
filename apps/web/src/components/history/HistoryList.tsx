import { Fragment } from "react";
import { foldRestatedEntries, PRE_MD_PR, RECONSTRUCTED_ERAS, type HistoryEntry } from "@/lib/history";
import { ApprovedByPoll } from "./ApprovedByPoll";
import { EntryRow } from "./EntryRow";
import { SeamFooter } from "./SeamFooter";
import { TimelineRow } from "./Timeline";

const ROOT_SHA = "4e931df";
const PRE_GIT_ERAS = new Set(["mip", "genesis", "severed"]);

export function HistoryList({ entries, railAbove }: { entries: HistoryEntry[]; railAbove: boolean }) {
  const sorted = foldRestatedEntries(entries).sort((a, b) =>
    a.commitSeq != null && b.commitSeq != null ? b.commitSeq - a.commitSeq : b.date.localeCompare(a.date),
  );
  const hasReconstructed = sorted.some((e) => e.era && RECONSTRUCTED_ERAS.has(e.era));
  const hasPreGit = sorted.some((e) => e.era && PRE_GIT_ERAS.has(e.era));
  return (
    <div>
      {sorted.map((entry, i) => (
        <HistoryItem
          key={i}
          entry={entry}
          isFirst={!railAbove && i === 0}
          hasPreGit={hasPreGit}
          hasReconstructed={hasReconstructed}
        />
      ))}
    </div>
  );
}

function HistoryItem({
  entry,
  isFirst,
  hasPreGit,
  hasReconstructed,
}: {
  entry: HistoryEntry;
  isFirst: boolean;
  hasPreGit: boolean;
  hasReconstructed: boolean;
}) {
  const isRootSnapshot =
    hasPreGit && entry.era === "html" && entry.changeType === "added" && entry.commitHash.startsWith(ROOT_SHA);
  return (
    <Fragment>
      <EntryRow entry={entry} labelOverride={isRootSnapshot ? "committed" : undefined} isFirst={isFirst} />
      <ApprovedByPoll pr={entry.pr} />
      {!hasReconstructed && entry.pr === PRE_MD_PR && (
        <TimelineRow>
          <SeamFooter seam={entry.seam} />
        </TimelineRow>
      )}
    </Fragment>
  );
}
