// computeOverlay over a three-claim atlas: a dated executive claim the model
// judges, an undated claim atlas history places, and one only the model's poll
// pick can place. Every I/O is a fake, so the assertions are about which source
// decided each claim and what the next run is left to do.
import { describe, expect, it } from "bun:test";

import type { AtlasNode } from "../../types.ts";
import type { Executive, Poll, VotesArtifact } from "../../lib/votes/types.ts";
import { computeOverlay, type ComputeDeps, type Judge } from "./compute.ts";

const MODEL = "typesafe/jev-1.13";
const TODAY = new Date(Date.UTC(2026, 9, 7));

function doc(id: string, content: string): AtlasNode {
  return { id, doc_no: `A.${id}`, title: `Doc ${id}`, type: "Core", depth: 1, parentId: null, order: 0, content, addressRefs: [] };
}
const docs = Object.fromEntries(
  [
    doc("osero", "The transfer of 10 million USDS to Osero was included in the March 26, 2026 Executive Vote."),
    doc("history", "The subsidized rate will apply beginning January 1, 2027."),
    doc("judge", "The new rate limits will take effect on February 1, 2027."),
  ].map((d) => [d.id, d]),
);

const executive: Executive = {
  file: "2026/executive-vote-2026-03-26.md", date: "2026-03-26", frontmatterDate: null, outOfSchedule: false, title: "Exec March 26", summary: "",
  address: "0x1", sections: [{ heading: "Transfers", text: "Transfer 10 million USDS to the Launch Agent 6 SubProxy.", authorization: [], proposal: [], atlasRefs: [] }],
  portal: { key: "k", date: "2026-03-26", active: false, hasBeenCast: true, datePassed: null, dateExecuted: null },
};
function poll(file: string, date: string, title: string): Poll {
  return {
    file, date, start: null, end: null, title, summary: title, discussionLink: null, atlasRefs: [], atlasPrs: [],
    portal: { pollId: 1, slug: file, multiHash: "", tags: [], winner: "Yes", numVoters: 1 },
  };
}
const artifact: VotesArtifact = {
  sources: { executives: "", polls: "", portal: null },
  executives: [executive],
  polls: [poll("2026/poll-history.md", "2026-11-20", "Atlas edit"), poll("2026/poll-rates.md", "2026-12-15", "Rate limits for February")],
};
const pollBodies = new Map([
  ["2026/poll-history.md", "Merges https://github.com/sky-ecosystem/next-gen-atlas/pull/121"],
  ["2026/poll-rates.md", "Sets new rate limits taking effect February 1."],
]);

function deps(over: Partial<ComputeDeps> = {}): ComputeDeps & { lanes: string[] } {
  const lanes: string[] = [];
  const judge: Judge = async (_state, questions, lane) => {
    lanes.push(lane);
    const nouls: Record<string, number | null> = "carried" in questions ? { anchor: 0.05, carried: 0.9 } : { p0: 0.6 };
    return nouls;
  };
  const firstPr = async (needle: string) => (needle.includes("January 1, 2027") ? 121 : null);
  return { model: MODEL, judge, firstPr, today: TODAY, lanes, ...over };
}

const byDoc = (claims: Record<string, unknown>, id: string) => Object.entries(claims).find(([k]) => k.startsWith(`${id}@`))?.[1];

describe("computeOverlay", () => {
  it("decides each claim by its most trusted source and tallies them", async () => {
    const d = deps();
    const r = await computeOverlay({ docs, artifact, pollBodies }, d);
    expect(Object.keys(r.claims)).toHaveLength(3);
    expect(byDoc(r.claims, "osero")).toMatchObject({ status: "enacted", via: "date", judged: { model: MODEL, p: 0.9, rule: "subject-missing" } });
    expect(byDoc(r.claims, "history")).toMatchObject({ status: "authorised", via: "history", vote: { title: "Atlas edit", url: "https://vote.sky.money/polling/2026/poll-history.md" } });
    expect(byDoc(r.claims, "judge")).toMatchObject({ status: "authorised", via: "judge", vote: { title: "Rate limits for February" }, judged: { p: 0.6, rule: "unlinked" } });
    expect(r).toMatchObject({ judged: 2, fromHistory: 1, unjudged: 0 });
    // History settled its claim, so the model was asked about only the other two.
    expect(d.lanes.sort()).toEqual(["vote-evidence-poll", "vote-evidence-subject"]);
  });

  it("keeps the rules' verdicts where no model is configured, and still uses history", async () => {
    const d = deps({ model: null });
    const r = await computeOverlay({ docs, artifact, pollBodies }, d);
    expect(byDoc(r.claims, "osero")).toMatchObject({ status: "subject-missing" });
    expect(byDoc(r.claims, "history")).toMatchObject({ via: "history" });
    expect(byDoc(r.claims, "judge")).toMatchObject({ status: "unlinked" });
    expect(d.lanes).toEqual([]);
  });

  it("counts a claim the model did not answer, so the next run asks again", async () => {
    const r = await computeOverlay({ docs, artifact, pollBodies }, deps({ judge: async () => null }));
    expect(r).toMatchObject({ judged: 0, unjudged: 2 });
    expect(byDoc(r.claims, "osero")).toMatchObject({ status: "subject-missing" });
    expect(byDoc(r.claims, "osero")).not.toHaveProperty("judged");
  });

  it("leaves a claim with no poll near its date to the rules, asking nothing", async () => {
    const far = { ...artifact, polls: artifact.polls.map((p) => ({ ...p, date: "2020-01-01" })) };
    const d = deps({ firstPr: async () => null });
    const r = await computeOverlay({ docs, artifact: far, pollBodies }, d);
    expect(byDoc(r.claims, "judge")).toMatchObject({ status: "unlinked" });
    expect(d.lanes).toEqual(["vote-evidence-subject"]);
  });
});
