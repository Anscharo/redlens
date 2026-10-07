// The pure parts of the vote-evidence eval: sentence extraction, the lexical
// prefilter, the judges' request shapes and answer parsing, and scoring.

import { describe, expect, it, vi } from "vitest";

import type { Executive } from "../../src/lib/votes/types.ts";
import type { PollCase, SubjectCase } from "./eval-vote-evidence-cases.ts";
import * as Q from "./eval-vote-evidence-judges.ts";
import { printReport } from "./eval-vote-evidence-report.ts";
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
  ({ key: "d@2026-03-26", docId: "d", docNo: "A.1", title: "Osero Transfer", date: "2026-03-26", sentence: "S.", documentText: "", claim, vote: exec("2026-03-26", "Transfer 10 million USDS."), gold: null, ...over }) as unknown as SubjectCase;
const pollCase = (files: string[], authorising: string[] = []): PollCase =>
  ({
    key: "d@2026-01-01", docId: "d", docNo: "A.1", title: "T", date: "2026-01-01", sentence: "S.", documentText: "", claim,
    candidates: files.map((file, i) => ({ id: `p${i}`, file, date: "2025-11-24", title: file, body: "b" })),
    windowFiles: files, gold: { docId: "d", date: "2026-01-01", label: authorising.length ? "authorised" : "none-expected", authorising, enacting: [], evidence: "" },
  }) as unknown as PollCase;

describe("printReport with several decision models", () => {
  it("prints one column and one sweep per decision model", () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
    const d = (carried: number) => ({ anchor: 0.05, carried, label: S.jevSubject(0.05, carried, 0.5) });
    const subject = [
      { key: "a", docNo: "A.1", slice: "real" as const, vote: "v", gold: "yes", heuristic: "yes" as const, decisions: { "jev-1.13": d(0.9), "gpt-6-luna-decisions": d(0.2) }, llm: null },
      { key: "b", docNo: "A.2", slice: "swapped" as const, vote: "v", gold: "no", heuristic: "yes" as const, decisions: { "jev-1.13": d(0.1), "gpt-6-luna-decisions": d(0.1) }, llm: null },
    ];
    const poll = [
      { key: "c", docNo: "A.3", gold: "authorised", acceptable: ["x.md"], candidates: ["x.md"], heuristic: "none", lexical: "x.md",
        decisions: { "jev-1.13": { nouls: { p0: 0.9 }, pick: "x.md" }, "gpt-6-luna-decisions": { nouls: { p0: 0.1 }, pick: "none" } } },
    ];
    printReport({ decisionModels: ["typesafe/jev-1.13", "openai/gpt-6-luna-decisions"], llmModel: "", tau: 0.5, staleGold: [], prefilter: { topK: "1/1", window: "1/1" }, subject, poll });
    spy.mockRestore();
    const out = lines.join("\n");
    expect(out).toMatch(/jev-1\.13\s+100%/);
    expect(out).toMatch(/gpt-6-luna-decisions\s+0%/);
    expect(out).toContain("gpt-6-luna-decisions carried threshold sweep");
    expect(out).toContain("jev-1.13 threshold sweep");
    expect(out).toContain("gpt-6-luna-decisions=no");
    expect(S.armName("openai/gpt-6-luna-decisions")).toBe("gpt-6-luna-decisions");
  });
});

describe("judges", () => {
  it("gives the LLM the decision models' state, polls numbered", () => {
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
