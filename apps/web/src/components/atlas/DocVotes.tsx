// The Executive Votes behind the open document, for the right panel's onchain
// section (executivesForDoc): each linked to vote.sky.money and, once its spell
// has been cast, to the spell contract, with why it is listed — it links the
// document, or it carried or failed to include one of the document's dated
// claims, as Stale Dates' vote evidence reads it. Polls show in the history list
// instead, under the edits they approved.
import { useMemo } from "react";
import type { AtlasNode } from "@/types";
import { executivesForDoc, type DocVote, type DocVoteReason } from "@/lib/votes/docVotes";
import { EVIDENCE_LABEL, evidenceHint, matchedViaText } from "@/lib/votes/labels";
import { loadVoteRecord } from "../../lib/votes";
import { SpellLink } from "../SpellLink";
import { SpellPauEffects } from "./SpellPauEffects";
import { useLoaded } from "../../hooks/useAtlasData";
import { useUTCDay } from "../../hooks/useUTCDay";
import { SECTION_HEAD } from "./panelSections";

/** The document's Executive Votes; empty until the vote record loads, and when there is none. */
export function useDocExecutives(id: string, docs: Record<string, AtlasNode>): DocVote[] {
  const record = useLoaded(loadVoteRecord, { soft: true });
  const day = useUTCDay();
  const doc = docs[id];
  return useMemo(
    () => (record && doc ? executivesForDoc(doc, docs, record.index, record.overlay, new Date(`${day}T12:00:00Z`)) : []),
    [record, doc, docs, day],
  );
}

export function ExecutiveVoteList({ votes }: { votes: DocVote[] }) {
  return (
    <div>
      <p className={`${SECTION_HEAD} mb-4`}>Executive Votes · {votes.length}</p>
      <ul className="space-y-4">
        {votes.map((v) => (
          <VoteRow key={v.url} vote={v} />
        ))}
      </ul>
    </div>
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
      {v.spell && <SpellPauEffects spell={v.spell} />}
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
  const via = matchedViaText(e);
  return (
    <>
      {r.raw}: <span title={evidenceHint(e)}>{via ? `${EVIDENCE_LABEL[e.status]} · ${via}` : EVIDENCE_LABEL[e.status]}</span>
    </>
  );
}
