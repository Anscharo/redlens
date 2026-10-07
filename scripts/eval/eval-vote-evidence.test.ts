// The pure parts of the vote-evidence eval: sentence extraction, the lexical
// prefilter, the judges' request shapes and answer parsing, and scoring.

import { describe, expect, it } from "vitest";

import type { Executive } from "../../src/lib/votes/types.ts";
import { claimSentence, type PollCase, type SubjectCase } from "./eval-vote-evidence-cases.ts";
import * as Q from "./eval-vote-evidence-judges.ts";
import { hasHistory, pickaxeNeedle, pollsLinkingPr, prOfSubject } from "./eval-vote-evidence-history.ts";
import { rankLexically } from "./eval-vote-evidence-lexical.ts";
import * as S from "./eval-vote-evidence-score.ts";

function exec(date: string, text: string): Executive {
  return {
    file: `2026/executive-vote-${date}.md`, date, frontmatterDate: null, outOfSchedule: false, title: `Exec ${date}`, summary: "", address: "0x1",
    sections: [{ heading: "[Genesis](https://x) Transfers", text, authorization: [], proposal: [], atlasRefs: [] }],
    portal: { key: "k", date, active: false, hasBeenCast: true, datePassed: null, dateExecuted: null },
  };
}

const claim = { context: "", contextBefore: "", raw: "March 26, 2026", voteEvidence: undefined, vote: null };
const subjectCase = (over: Partial<SubjectCase> = {}): SubjectCase =>
  ({ key: "d@2026-03-26", docId: "d", docNo: "A.1", title: "Osero Transfer", date: "2026-03-26", sentence: "S.", claim, vote: exec("2026-03-26", "Transfer 10 million USDS."), gold: null, ...over }) as unknown as SubjectCase;
const pollCase = (files: string[], authorising: string[] = []): PollCase =>
  ({
    key: "d@2026-01-01", docId: "d", docNo: "A.1", title: "T", date: "2026-01-01", sentence: "S.", claim,
    candidates: files.map((file, i) => ({ id: `p${i}`, file, date: "2025-11-24", title: file, body: "b" })),
    windowFiles: files, gold: { docId: "d", date: "2026-01-01", label: authorising.length ? "authorised" : "none-expected", authorising, enacting: [], evidence: "" },
  }) as unknown as PollCase;

describe("claimSentence", () => {
  it("returns the whole sentence around the date, links reduced to text", () => {
    const content = "First one. The [transfer](https://x) to Keel was included in the March 26, 2026 Executive Vote. Next one.";
    const c = { context: "to Keel was included in the March 26, 2026 Executive Vote.", contextBefore: "to Keel was included in the ", raw: "March 26, 2026" };
    expect(claimSentence(content, c)).toBe("The transfer to Keel was included in the March 26, 2026 Executive Vote.");
  });

  it("falls back to the raw date, then to the context", () => {
    expect(claimSentence("Begins on May 1, 2026 for all.", { context: "nope", contextBefore: "", raw: "May 1, 2026" })).toBe("Begins on May 1, 2026 for all.");
    expect(claimSentence("No date here.", { context: "ctx", contextBefore: "", raw: "May 1, 2026" })).toBe("ctx");
  });
});

describe("history arm helpers", () => {
  it("builds a pickaxe needle from the words before the date, cut at markdown", () => {
    expect(pickaxeNeedle({ contextBefore: "subsidized rate for an initial period of 2 years, beginning ", raw: "January 1, 2026" })).toBe(
      "eriod of 2 years, beginning January 1, 2026",
    );
    expect(pickaxeNeedle({ contextBefore: "see [the doc](x) effective ", raw: "May 20, 2026" })).toBe("effective May 20, 2026");
  });

  it("reads a squash-merge PR number and finds the polls linking it", () => {
    expect(prOfSubject("Nov 24 Atlas edit (#121)")).toBe(121);
    expect(prOfSubject("Merge branch main")).toBeNull();
    const bodies = new Map([
      ["a.md", "see https://github.com/sky-ecosystem/next-gen-atlas/pull/121"],
      ["b.md", "see https://github.com/sky-ecosystem/next-gen-atlas/pull/1210"],
    ]);
    expect(pollsLinkingPr(121, bodies)).toEqual(["a.md"]);
  });

  it("reports no history for a directory that is not a repository", () => {
    expect(hasHistory("/nonexistent-dir")).toBe(false);
  });
});

describe("rankLexically", () => {
  it("ranks the document sharing the rare words first", () => {
    const docs = ["weekly cycle edits for spark", "trigger subsidized borrowing for spark and grove as of january", "weekly cycle edits for grove"];
    expect(rankLexically("subsidized borrowing beginning january", docs)[0]).toBe(1);
  });
});

describe("judges", () => {
  it("sends section text with link markup stripped from headings", () => {
    const state = Q.subjectState(subjectCase());
    expect(state.executive_vote.sections[0].heading).toBe("Genesis Transfers");
    expect(state.claim.vote_date_named).toBe("2026-03-26");
  });

  it("asks one poll Noul per candidate, by position", () => {
    const q = Q.pollQuestions(pollCase(["a.md", "b.md"]));
    expect(Object.keys(q)).toEqual(["p0", "p1"]);
    expect(String(q.p1.instructions)).toContain("`polls[1]`");
    expect(JSON.parse(Q.pollMessages(pollCase(["a.md"]))[1].content).polls[0].id).toBe("p0");
    expect(Q.subjectMessages(subjectCase())[0].role).toBe("system");
  });

  it("reads only well-formed LLM answers", () => {
    expect(Q.parseLlmSubject('```json\n{"anchor":false,"carried":"no","section":"none","quote":""}\n```')).toEqual({ anchor: false, carried: "no", quote: "" });
    expect(Q.parseLlmSubject('{"anchor":"no","carried":"yes"}')).toBeNull();
    expect(Q.parseLlmSubject("not json {")).toBeNull();
    expect(Q.parseLlmPoll('{"match":"p1"}', ["p0", "p1"])).toBe("p1");
    expect(Q.parseLlmPoll('{"match":"none"}', ["p0"])).toBe("none");
    expect(Q.parseLlmPoll('{"match":"p9"}', ["p0"])).toBeNull();
  });
});

describe("scoring", () => {
  it("labels the heuristic and Jev arms", () => {
    expect(S.heuristicSubject(subjectCase({ claim: { ...claim, vote: { anchor: true, outOfSchedule: false, subject: [] } } as never }))).toBe("anchor");
    expect(S.heuristicSubject(subjectCase({ claim: { ...claim, voteEvidence: { status: "subject-missing" } } as never }))).toBe("no");
    expect(S.heuristicSubject(subjectCase({ claim: { ...claim, voteEvidence: { status: "enacted", subject: { found: ["keel"], missing: [] } } } as never }))).toBe("yes");
    expect(S.heuristicSubject(subjectCase())).toBe("abstain");
    expect(S.jevSubject(0.9, 0.1, 0.5)).toBe("anchor");
    expect(S.jevSubject(0.1, 0.6, 0.5)).toBe("yes");
    expect(S.jevSubject(0.1, 0.4, 0.5)).toBe("no");
    expect(S.jevSubject(null, 0.4, 0.5)).toBe("error");
  });

  it("scores answered cases, counts caught negatives and false alarms, and drops unclear gold", () => {
    const s = S.scoreSubject([
      { gold: "yes", pred: "yes" },
      { gold: "yes", pred: "no" },
      { gold: "no", pred: "no" },
      { gold: "yes", pred: "abstain" },
      { gold: "unclear", pred: "yes" },
    ]);
    expect(s).toMatchObject({ n: 4, answered: 3, correct: 2, caught: "1/1", falseAlarms: 1 });
    expect(s.coverage).toBe(0.75);
  });

  it("swaps in a far executive that lacks the gold evidence line", () => {
    const c = subjectCase();
    const execs = [exec("2026-03-30", "Transfer 10 million USDS to Keel"), exec("2026-06-01", "Transfer 10 million USDS to Keel"), exec("2026-07-01", "Other")];
    expect(S.swapExecutive(c, execs, "Transfer 10 million USDS to Keel")?.date).toBe("2026-07-01");
    expect(S.swapExecutive(c, execs.slice(0, 2), "Transfer 10 million USDS to Keel")).toBeNull();
  });

  it("picks the poll Jev rates highest above the threshold, and scores polls", () => {
    const c = pollCase(["a.md", "b.md"], ["b.md"]);
    expect(S.jevPoll(c, { p0: 0.4, p1: 0.8 }, 0.5)).toBe("b.md");
    expect(S.jevPoll(c, { p0: 0.4, p1: 0.3 }, 0.5)).toBe("none");
    expect(S.jevPoll(c, null, 0.5)).toBeNull();
    const s = S.scorePoll([{ acceptable: ["b.md"], pred: "b.md" }, { acceptable: [], pred: "a.md" }, { acceptable: [], pred: null }]);
    expect(s).toMatchObject({ n: 3, correct: 1, found: "1/1", falseMatches: "1/2", errors: 1 });
    expect(S.prefilterRecall([c, pollCase(["a.md"], ["z.md"])])).toEqual({ topK: "1/2", window: "1/2" });
  });

  it("reads the shipped matcher's poll pick from its evidence", () => {
    const c = pollCase(["a.md"]);
    const auth = { ...c, claim: { ...claim, voteEvidence: { status: "authorised", vote: { date: "2025-11-24", title: "Atlas Edit" } } } } as never;
    expect(S.heuristicPoll(auth, new Map([["2025-11-24|Atlas Edit", "x.md"]]))).toBe("x.md");
    expect(S.heuristicPoll(c, new Map())).toBe("none");
  });
});
