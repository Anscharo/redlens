// The vote-evidence line under a Stale Dates claim: what the Sky vote record
// shows for it, the vote it matched (linked to vote.sky.money), and any of the
// claim's named things that vote never mentions.
import type { VoteEvidence, VoteEvidenceStatus } from "@/lib/votes/evidence";
import { EVIDENCE_HINT, EVIDENCE_LABEL, missingSubject, signedDays } from "@/lib/votes/labels";
import type { ReportQuery } from "@/lib/reportFilter";
import { Highlight } from "./Highlight";

// Warnings read as errors, open questions as cautions, confirmations as links.
const TONE: Record<VoteEvidenceStatus, string> = {
  enacted: "var(--accent)",
  "vote-on-date": "var(--accent)",
  authorised: "var(--accent)",
  pending: "var(--warn)",
  "not-covered": "var(--tan-3)",
  unlinked: "var(--tan-3)",
  "subject-missing": "var(--error-text)",
  "no-vote": "var(--error-text)",
};

export function VoteEvidenceLine({ evidence: e, rq }: { evidence: VoteEvidence; rq: ReportQuery }) {
  const missing = missingSubject(e);
  return (
    <p className="text-sm ml-4 px-3 pb-3 flex items-baseline gap-3 flex-wrap text-tan-3">
      <span
        className="mono text-xs px-1.5 py-0.5 rounded border"
        style={{ color: TONE[e.status], borderColor: "currentColor" }}
        title={EVIDENCE_HINT[e.status]}
      >
        <Highlight text={EVIDENCE_LABEL[e.status]} rq={rq} />
      </span>
      {e.vote && (
        <a href={e.vote.url} target="_blank" rel="noreferrer" title={e.vote.title} className="mono text-xs text-accent">
          {e.vote.kind} {e.vote.date} ({signedDays(e.vote.offsetDays)})
        </a>
      )}
      {missing.length > 0 && (
        <span className="text-xs">
          not in that {e.vote?.kind ?? "vote"}: <Highlight text={missing.join(", ")} rq={rq} />
        </span>
      )}
    </p>
  );
}
