// The reader panel's votes section: the executive votes behind the open
// document (executivesForDoc), each linked to vote.sky.money with why it is
// listed — it links the document, or it carried or failed to mention one of the
// document's dated claims, as Stale Dates' vote evidence reads it. Polls show in
// the history list instead, under the edits they approved.
import { useMemo } from "react";
import type { AtlasNode } from "@/types";
import { executivesForDoc, type DocVote, type DocVoteReason } from "@/lib/votes/docVotes";
import { EVIDENCE_LABEL, evidenceHint, matchedVia } from "@/lib/votes/labels";
import { loadVoteRecord } from "../../lib/votes";
import { SpellLink } from "../SpellLink";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUTCDay } from "../../hooks/useUTCDay";

const STATUS_LINE = "text-xs mono text-tan-3";

export function DocVotes({ id, docs }: { id: string; docs: Record<string, AtlasNode> }) {
  const record = useLoaded(loadVoteRecord);
  const day = useUTCDay();
  const doc = docs[id];
  const votes = useMemo(
    () => (record && doc ? executivesForDoc(doc, docs, record.index, record.overlay, new Date(`${day}T12:00:00Z`)) : []),
    [record, doc, docs, day],
  );
  if (!record) return <p className={STATUS_LINE}>loading votes…</p>;
  if (!record.index && !record.overlay) return <p className={STATUS_LINE}>Vote record unavailable.</p>;
  if (!votes.length) return <p className={STATUS_LINE}>No executive vote links this section or matches its dates.</p>;
  return (
    <ul className="space-y-4">
      {votes.map((v) => (
        <VoteRow key={v.url} vote={v} />
      ))}
    </ul>
  );
}

function VoteRow({ vote: v }: { vote: DocVote }) {
  return (
    <li>
      <a href={v.url} target="_blank" rel="noreferrer" className="text-xs mono text-accent hover:underline">
        Executive Vote {v.date}
      </a>
      {v.spell && (
        <>
          {" · "}
          <SpellLink address={v.spell} />
        </>
      )}
      <p className="text-xs leading-relaxed text-tan-2">{v.title}</p>
      {v.reasons.map((r, i) => (
        <p key={i} className="text-[11px] mono text-tan-3">
          {reasonText(r)}
        </p>
      ))}
    </li>
  );
}

function reasonText(r: DocVoteReason) {
  if (r.kind === "links") return "links this section";
  const e = r.evidence;
  const via = matchedVia(e);
  return (
    <>
      {r.raw}: <span title={evidenceHint(e)}>{via ? `${EVIDENCE_LABEL[e.status]} · via ${via}` : EVIDENCE_LABEL[e.status]}</span>
    </>
  );
}
