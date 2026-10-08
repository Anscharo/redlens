import { describe, expect, it } from "vitest";

import type { AtlasNode } from "../../types";
import { votesForDoc } from "./docVotes";
import { claimKey, judgeSubject } from "./overlay";
import { extractDateClaims } from "../staleDates";
import type { Executive, Poll, VotesArtifact, VoteLink } from "./types";
import { buildVoteIndex } from "./vote-index";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const TODAY = new Date(Date.UTC(2026, 9, 7));
const link = (uuid: string): VoteLink => ({ family: "atlas", url: `https://sky-atlas.io/#${uuid}`, text: "doc", uuid });

function executive(date: string, refs: VoteLink[] = []): Executive {
  return {
    file: `2026/executive-vote-${date}.md`, date, frontmatterDate: null, outOfSchedule: false, title: `Exec ${date}`, summary: "", address: "0x1",
    sections: [{ heading: "Transfers", text: "Transfer 10 million USDS to the Launch Agent 6 SubProxy.", authorization: [], proposal: [], atlasRefs: refs }],
    portal: { key: `k-${date}`, date, active: false, hasBeenCast: true, datePassed: null, dateExecuted: null },
  };
}
const poll: Poll = {
  file: "2026/poll-1.md", date: "2026-02-02", start: null, end: null, title: "Atlas Edit", summary: "", discussionLink: null, atlasRefs: [link(DOC_ID)], atlasPrs: [],
  portal: { pollId: 1, slug: "atlas-edit", multiHash: "", tags: [], winner: "Yes", numVoters: 1 },
};
const artifact: VotesArtifact = { sources: { executives: "", polls: "", portal: null }, executives: [executive("2026-03-26", [link(DOC_ID)]), executive("2026-05-01")], polls: [poll] };
const doc: AtlasNode = {
  id: DOC_ID, doc_no: "A.1", title: "Osero", type: "Core", depth: 1, parentId: null, order: 0, addressRefs: [],
  content: "The transfer of 10 million USDS to Osero was included in the March 26, 2026 Executive Vote.",
};
const docs = { [DOC_ID]: doc };

describe("votesForDoc", () => {
  it("lists each vote once, newest first, with every reason it is listed", () => {
    const votes = votesForDoc(doc, docs, buildVoteIndex(artifact), null, TODAY);
    expect(votes.map((v) => [v.kind, v.date])).toEqual([["executive", "2026-03-26"], ["poll", "2026-02-02"]]);
    expect(votes[0].url).toBe("https://vote.sky.money/executive/k-2026-03-26");
    expect(votes[0].reasons.map((r) => r.kind)).toEqual(["links", "claim"]);
    expect(votes[0].reasons[1]).toMatchObject({ raw: "March 26, 2026", evidence: { status: "subject-missing" } });
    expect(votes[1]).toMatchObject({ title: "Atlas Edit", url: "https://vote.sky.money/polling/atlas-edit", reasons: [{ kind: "links" }] });
  });

  it("takes the worker's verdict for a claim, even without the vote record", () => {
    const index = buildVoteIndex(artifact);
    const claim = extractDateClaims(doc, Date.UTC(2026, 9, 7)).claims[0];
    const rule = votesForDoc(doc, docs, index, null, TODAY)[0].reasons[1];
    if (rule.kind !== "claim") throw new Error("expected a claim reason");
    const judged = judgeSubject(rule.evidence, true, { model: "m", anchor: 0, carried: 0.9 });
    const overlay = { atlasSha: "s", computedAt: "t", claims: { [claimKey(claim)]: judged } };
    expect(votesForDoc(doc, docs, index, overlay, TODAY)[0].reasons[1]).toMatchObject({ evidence: { status: "enacted", judged: { rule: "subject-missing" } } });
    const only = votesForDoc(doc, docs, null, overlay, TODAY);
    expect(only).toHaveLength(1);
    expect(only[0].reasons).toEqual([{ kind: "claim", raw: "March 26, 2026", evidence: judged }]);
  });

  it("is empty for a document no vote links or dates", () => {
    expect(votesForDoc({ ...doc, id: "other", content: "No dates." }, docs, buildVoteIndex(artifact), null, TODAY)).toEqual([]);
  });
});

describe("buildVoteIndex approvals", () => {
  const p = (file: string, date: string, prs: number[] | undefined, winner = "Yes"): Poll => ({ ...poll, file, date, atlasPrs: prs as number[], portal: { ...poll.portal!, slug: file, winner } });

  it("maps each pull request to the earliest passed poll linking it", () => {
    const index = buildVoteIndex({
      ...artifact,
      polls: [p("b", "2025-12-01", [121]), p("a", "2025-11-24", [121, 130]), p("c", "2025-11-01", [121], "No"), p("old", "2025-10-01", undefined)],
    });
    expect(index.approvals.get(121)).toEqual({ title: "Atlas Edit", date: "2025-11-24", url: "https://vote.sky.money/polling/a" });
    expect(index.approvals.get(130)?.date).toBe("2025-11-24");
    expect(index.approvals.has(999)).toBe(false);
  });
});

