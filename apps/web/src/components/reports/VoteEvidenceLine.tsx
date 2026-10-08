// The vote-evidence line under a Stale Dates claim: what the Sky vote record
// shows for it, the vote it matched (linked to vote.sky.money), any of the
// claim's named things that vote never mentions, and how it was matched (its
// date, a link, atlas history or an AI model; the hover says the rest).
import type { VoteEvidence, VoteEvidenceStatus } from "@/lib/votes/evidence";
import { EVIDENCE_LABEL, evidenceHint, matchedViaText, missingSubject, signedDays, VOTE_KIND } from "@/lib/votes/labels";
import type { ReportQuery } from "@/lib/reportFilter";
import { Highlight } from "./Highlight";
import { SpellLink } from "../SpellLink";

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
  const via = matchedViaText(e);
  return (
    <p className="text-sm ml-4 px-3 pb-3 flex items-baseline gap-3 flex-wrap text-tan-3">
      <span
        className="mono text-xs px-1.5 py-0.5 rounded border"
        style={{ color: TONE[e.status], borderColor: "currentColor" }}
        title={evidenceHint(e)}
      >
        <Highlight text={EVIDENCE_LABEL[e.status]} rq={rq} />
      </span>
      {e.vote && (
        <a href={e.vote.url} target="_blank" rel="noreferrer" title={e.vote.title} className="mono text-xs text-accent">
          {VOTE_KIND[e.vote.kind]} {e.vote.date} ({signedDays(e.vote.offsetDays)})
        </a>
      )}
      {e.vote?.spell && <SpellLink address={e.vote.spell} />}
      {via && (
        <span className="mono text-xs" title={evidenceHint(e)}>
          {via}
        </span>
      )}
      {missing.length > 0 && (
        <span className="text-xs">
          not in that {e.vote ? VOTE_KIND[e.vote.kind] : "vote"}: <Highlight text={missing.join(", ")} rq={rq} />
        </span>
      )}
    </p>
  );
}
