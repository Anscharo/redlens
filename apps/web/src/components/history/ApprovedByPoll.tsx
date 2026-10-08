// The governance poll that approved a history entry's pull request, linked to
// vote.sky.money: the earliest passed poll whose body links that pull request
// (votes.json's atlasPrs, indexed as VoteIndex.approvals). Renders nothing for
// an entry without a pull request, one no poll links, or before the vote
// record loads; a missing vote record never fails the history.
import { loadVoteIndex } from "../../lib/votes";
import { useLoaded } from "../../hooks/useAtlasData";
import { TimelineRow } from "./Timeline";

export function ApprovedByPoll({ pr }: { pr?: number }) {
  const votes = useLoaded(loadVoteIndex, { soft: true });
  const poll = pr ? votes?.approvals.get(pr) : undefined;
  if (!poll) return null;
  return (
    <TimelineRow>
      <p className="mono text-[11px] text-tan-3 pb-2" data-testid="approved-by-poll">
        approved by{" "}
        <a href={poll.url} target="_blank" rel="noreferrer" title={poll.title} className="text-accent hover:underline">
          poll {poll.date}
        </a>
      </p>
    </TimelineRow>
  );
}
