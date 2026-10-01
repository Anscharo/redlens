// The note goes back to the MODEL, and its whole job is to say what the READER
// saw. So the copy is pinned against the web components it mirrors — those live
// in apps/web and cannot be imported here, which is exactly why they need a test
// rather than a comment.
import { test, expect, describe } from "bun:test";
import {
  reviewNoteFrom,
  reviewNoteFromChecks,
  badgeLabel,
  findingsOf,
  coverageOf,
  marksOf,
  MAX_FINDINGS,
  FINDING_CHARS,
  type CheckRow,
} from "./review-note.ts";
import type { VerifyOut } from "./persisted-verdict.ts";

const CLEAN: VerifyOut = {
  status: "pass",
  contradictions: [],
  rulingIssued: false,
  invalidCitations: [],
  invalidDocNos: [],
  docNoMismatches: [],
  ungroundedQuotes: [],
  ungroundedAddresses: [],
  ungroundedCitationValues: [],
  paramMismatches: [],
  completenessFailures: [],
  missingExternalDisclaimer: false,
  mscCitedAsAtlas: [],
  lengthCapped: false,
};
const verify = (over: Partial<VerifyOut>): VerifyOut => ({ ...CLEAN, ...over });
// AgreedContradiction is the READER-facing shape (answer/evidence); the stored
// verdict row carries the raw one (answer_span/evidence_span) that
// agreedContradictionsFrom maps from. Both are needed, and conflating them is
// exactly the kind of drift this file exists to catch.
const dispute = (uuid: string | null = null) => ({ answer: "a claim", evidence: "the atlas text", why: "they differ", uuid });
const storedDispute = (uuid: string | null = null) => ({
  answer_span: "a claim", evidence_span: "the atlas text", why: "they differ", evidence_label: "[E1]", uuid, source: "model", agreed: true,
});

describe("badgeLabel mirrors VerifyBadge.tsx chipLabel", () => {
  test("a fail with contradictions is counted and pluralised, exactly as the chip is", () => {
    expect(badgeLabel(verify({ status: "fail", contradictions: [dispute()] }))).toBe("1 statement disputed by the atlas");
    expect(badgeLabel(verify({ status: "fail", contradictions: [dispute(), dispute()] }))).toBe("2 statements disputed by the atlas");
  });

  test("a fail with no contradictions is the deterministic-only wording", () => {
    // This is the case the whole feature exists for: a red badge whose cause is a
    // deterministic finding, with no disputed statement to point at.
    expect(badgeLabel(verify({ status: "fail", ungroundedQuotes: ["an invented quote"] }))).toBe("failed verification");
  });

  test("warn is ruling-only, and unverified shows no badge at all", () => {
    expect(badgeLabel(verify({ status: "warn", rulingIssued: true }))).toBe("caution: the answer issues a ruling");
    expect(badgeLabel(verify({ status: "unverified" }))).toBeNull();
  });
});

describe("findingsOf mirrors VerifyFindings.tsx", () => {
  test("reuses describeFindings' wording rather than re-authoring it", () => {
    const f = findingsOf(verify({
      status: "fail",
      invalidCitations: ["00000000-dead-beef-0000-000000000000"],
      ungroundedQuotes: ["a quote that is in no source"],
      ungroundedAddresses: ["0xdeadbeef"],
    }));
    expect(f).toContain("cites a document that does not exist: 00000000-dead-beef-0000-000000000000");
    expect(f).toContain("quote not found in any retrieved source: “a quote that is in no source”");
    expect(f).toContain("address not found in any retrieved source: 0xdeadbeef");
  });

  test("covers the four findings describeFindings does not take", () => {
    expect(findingsOf(verify({ status: "fail", lengthCapped: true }))).toEqual([
      "the answer was cut off by the output length limit before it finished",
    ]);
    expect(findingsOf(verify({ status: "fail", missingExternalDisclaimer: true }))).toEqual([
      "settlement figures were used without saying they are not from the Atlas",
    ]);
    expect(findingsOf(verify({ status: "warn", rulingIssued: true }))).toEqual([
      "the answer issues a ruling instead of reporting what the atlas says",
    ]);
    expect(findingsOf(verify({ status: "fail", completenessFailures: ["asked for the oldest, answered from a ranked page"] }))).toEqual([
      "asked for the oldest, answered from a ranked page",
    ]);
  });

  test("each finding is clipped, and the list is capped with a count of the rest", () => {
    const long = "x".repeat(400);
    expect(findingsOf(verify({ status: "fail", completenessFailures: [long] }))[0]).toHaveLength(FINDING_CHARS);
    const many = Array.from({ length: MAX_FINDINGS + 3 }, (_, i) => `finding ${i}`);
    const note = reviewNoteFrom({ verify: verify({ status: "fail", completenessFailures: many }), coverage: null, marks: {} })!;
    expect(note.findings).toHaveLength(MAX_FINDINGS + 1);
    expect(note.findings.at(-1)).toBe("…and 3 more");
  });
});

describe("coverageOf mirrors answerFacts", () => {
  test("a plain `answers` verdict adds nothing", () => {
    expect(coverageOf({ verdict: "answers", missingParts: [] })).toBeNull();
    expect(coverageOf(null)).toBeNull();
  });

  test("names the verdict and the parts that went unanswered", () => {
    expect(coverageOf({ verdict: "declines", missingParts: [] })).toBe("declined to answer");
    expect(coverageOf({ verdict: "asks", missingParts: [] })).toBe("asked a clarifying question instead of answering");
    expect(coverageOf({ verdict: "deflects", missingParts: ["when it takes effect"] })).toBe(
      "answered something adjacent rather than what was asked; didn't address: “when it takes effect”",
    );
  });
});

describe("marksOf", () => {
  test("drops the quiet default and keeps the three a reader asks about", () => {
    const marks = {
      "11111111-1111-1111-1111-111111111111": { status: "backed" as const, claims: [], confidence: 0.99 },
      "22222222-2222-2222-2222-222222222222": { status: "disputed" as const, claims: [], confidence: 0.9 },
      "33333333-3333-3333-3333-333333333333": { status: "unread" as const, claims: [], confidence: null },
      "44444444-4444-4444-4444-444444444444": { status: "uncovered" as const, claims: [], confidence: null },
    };
    expect(marksOf(marks)).toEqual(["doc 22222222 marked disputed", "doc 33333333 marked unread", "doc 44444444 marked uncovered"]);
  });

  test("an all-clean answer contributes no marks", () => {
    expect(marksOf({ "11111111-1111-1111-1111-111111111111": { status: "backed", claims: [], confidence: 1 } })).toEqual([]);
  });
});

describe("reviewNoteFrom", () => {
  test("nothing worth saying is null, not an empty shell", () => {
    expect(reviewNoteFrom({ verify: null, coverage: null, marks: {} })).toBeNull();
    // `unverified` renders no badge and a clean coverage adds nothing.
    expect(reviewNoteFrom({ verify: verify({ status: "unverified" }), coverage: { verdict: "answers", missingParts: [] }, marks: {} })).toBeNull();
  });

  test("a passing answer still carries its badge, so the model can say so", () => {
    const note = reviewNoteFrom({ verify: CLEAN, coverage: null, marks: {} })!;
    expect(note.badge).toBe("verified");
    expect(note.findings).toEqual([]);
  });

  test("coverage or marks alone are enough to make a note", () => {
    const note = reviewNoteFrom({ verify: null, coverage: { verdict: "declines", missingParts: [] }, marks: {} })!;
    expect(note.coverage).toBe("declined to answer");
    expect(note.badge).toBe("");
  });
});

describe("reviewNoteFromChecks", () => {
  const roundChecks = (checks: Record<string, unknown>): CheckRow => ({
    kind: "round_checks",
    verdict: { checks: { failed: true, citations: 0, ...checks } },
    overall: null,
  });

  test("builds the note the reader saw from the stored rows", () => {
    const note = reviewNoteFromChecks([roundChecks({ ungroundedQuotes: ["a quote in no source"] })])!;
    expect(note.badge).toBe("failed verification");
    expect(note.findings).toContain("quote not found in any retrieved source: “a quote in no source”");
  });

  test("no rows at all means no note", () => {
    expect(reviewNoteFromChecks([])).toBeNull();
  });

  test("a corrupt payload degrades to null and never throws", () => {
    // persisted-verdict.ts promises never to throw; this is the promise being
    // relied on, so it is asserted rather than assumed.
    expect(() => reviewNoteFromChecks([{ kind: "round_checks", verdict: "not an object", overall: null }])).not.toThrow();
    expect(() => reviewNoteFromChecks([{ kind: "verify", verdict: null, overall: "fail" }])).not.toThrow();
    expect(() => reviewNoteFromChecks([{ kind: "citation_check", verdict: { judged: "nope" }, overall: null }])).not.toThrow();
    expect(() => reviewNoteFromChecks([{ kind: "answer_coverage", verdict: { verdict: 42 }, overall: null }])).not.toThrow();
  });

  test("a message with only an answer_coverage row still gets its line", () => {
    const note = reviewNoteFromChecks([
      { kind: "answer_coverage", verdict: { verdict: "deflects", missingParts: ["the deadline"] }, overall: null },
    ])!;
    expect(note.coverage).toBe("answered something adjacent rather than what was asked; didn't address: “the deadline”");
  });

  test("a disputed mark reaches the note; a backed one never does", () => {
    const disputedUuid = "22222222-2222-2222-2222-222222222222";
    const backedUuid = "11111111-1111-1111-1111-111111111111";
    const note = reviewNoteFromChecks([
      {
        kind: "citation_check",
        verdict: {
          judged: [
            { uuid: disputedUuid, claim: "a claim", verdict: "contradicts", confidence: 0.97, lane: "content", confirmed: true },
            { uuid: backedUuid, claim: "another claim", verdict: "supports", confidence: 0.99, lane: "content" },
          ],
        },
        overall: null,
      },
    ])!;
    expect(note.marks).toEqual([`doc ${disputedUuid.slice(0, 8)} marked disputed`]);
  });

  // withoutDisputedMarks is in this path for parity with the wire event, but it
  // is currently a NO-OP here and the honest thing is to say so rather than ship
  // a test that looks like it proves otherwise: the only statuses it rewrites are
  // the check-drawing ones, and marksOf already drops every `backed` mark as the
  // quiet default. Keeping the call means that if marksOf ever starts reporting
  // checks, the reconciliation is already correct instead of newly missing.
  test("a backed mark on a disputed doc is absent either way — via marksOf, not reconciliation", () => {
    const uuid = "22222222-2222-2222-2222-222222222222";
    const citationRow: CheckRow = {
      kind: "citation_check",
      verdict: { judged: [{ uuid, claim: "a claim", verdict: "supports", confidence: 0.99, lane: "content" }] },
      overall: null,
    };
    // Alone, it produces no note at all — the ✓ is dropped before reconciliation
    // ever sees it.
    expect(reviewNoteFromChecks([citationRow])).toBeNull();
    const withDispute = reviewNoteFromChecks([
      citationRow,
      { kind: "verify", verdict: { contradictions: [storedDispute(uuid)] }, overall: "fail" },
    ])!;
    expect(withDispute.marks).toEqual([]);
    expect(withDispute.badge).toBe("1 statement disputed by the atlas");
  });
});
