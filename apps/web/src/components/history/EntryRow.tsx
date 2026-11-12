import { CHANGE_COLOR, isGitSha, severedRange, type HistoryEntry } from "@/lib/history";
import { DiffView } from "./DiffView";
import { ChangeLabel } from "./ChangeLabel";
import { EntryCommitLink, EntryCommitTag } from "./EntryCommit";
import { EntryMethodBadge } from "./EntryMethodBadge";
import { EntryPrLink } from "./EntryPrLink";
import { EntryProvenance } from "./EntryProvenance";
import { EntrySourceLink } from "./EntrySourceLink";
import { EntryTitle } from "./EntryTitle";
import { EntryDate, EntryRange } from "./EntryWhen";
import { LINE1_H, TimelineRow } from "./Timeline";

interface Props {
  entry: HistoryEntry;
  /** Override the change-type label text for this one row — used by NodeHistory to
   *  relabel the root html-snapshot "added" event "first git snapshot" when older
   *  reconstructed origin events exist below it (docs/plans/pre-git-history.md). */
  labelOverride?: string;
  /** Newest (topmost) entry — trims the timeline line above its node. */
  isFirst?: boolean;
}

// Pre-git origin events carry a self-descriptive summary, so an "added" chip beside it is noise.
const PRE_GIT_ADDED_ERAS = new Set(["mip", "genesis", "severed"]);

export function EntryRow({ entry, labelOverride, isFirst }: Props) {
  const pr = entry.pr;
  const gitSha = isGitSha(entry.commitHash);
  const hideChangeLabel =
    !labelOverride && entry.changeType === "added" && !!entry.era && PRE_GIT_ADDED_ERAS.has(entry.era);
  const title = entry.summary ?? (pr ? entry.prTitle : undefined);
  const range = entry.date ? null : severedRange(entry.commitHash);
  return (
    <article>
      <TimelineRow dot={CHANGE_COLOR[entry.changeType]} hideTop={isFirst}>
        <h4 className="flex items-baseline gap-2 flex-wrap mono text-[13px]" style={{ lineHeight: `${LINE1_H}px` }}>
          {entry.date ? <EntryDate date={entry.date} /> : range ? <EntryRange range={range} /> : null}
          <EntryProvenance era={entry.era} />
          <EntryCite pr={pr} prUrl={entry.prUrl} gitSha={gitSha} hash={entry.commitHash} sourceUrl={entry.sourceUrl} range={range} />
          <EntryMethodBadge era={entry.era} method={entry.method} />
        </h4>
        {title ? <EntryTitle text={title} /> : null}
        {!hideChangeLabel && <ChangeLabel entry={entry} label={labelOverride} />}
        {entry.diff && <DiffView lines={entry.diff} />}
      </TimelineRow>
    </article>
  );
}

function EntryCite({ pr, prUrl, gitSha, hash, sourceUrl, range }: {
  pr?: number;
  prUrl?: string;
  gitSha: boolean;
  hash: string;
  sourceUrl?: string;
  range: string | null;
}) {
  if (pr) return <EntryPrLink pr={pr} prUrl={prUrl} />;
  if (gitSha) return <EntryCommitLink hash={hash} />;
  if (sourceUrl) return <EntrySourceLink href={sourceUrl} />;
  if (range) return null;
  return <EntryCommitTag hash={hash} />;
}
