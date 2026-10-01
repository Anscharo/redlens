import { describe, expect, it } from "bun:test";
import {
  reviewRound,
  isReviewRound,
  REVIEW_TOOL_NAME,
  REVIEW_TOOL_ID,
  REVIEW_LOOKBACK,
  REVIEW_ROUND_MAX_CHARS,
  DIGEST_MAX_CHARS,
  MAX_DISPUTES,
  type ReviewRow,
} from "./review-round.ts";
import type { ReviewNote } from "./verify/review-note.ts";
import type { AgreedContradiction } from "./verify/disputes.ts";

const c = (over: Partial<AgreedContradiction> = {}): AgreedContradiction => ({
  answer: "They carry out operational activities on behalf of the Prime Agents they serve.",
  evidence: "GovOps actors carry out operational activities on behalf of Executor Agents.",
  why: "Subject mismatch: the sentence says Prime Agents, the atlas text says Executor Agents.",
  uuid: "76405733-0000-0000-0000-000000000000",
  ...over,
});

const note = (over: Partial<ReviewNote> = {}): ReviewNote => ({
  badge: "failed verification",
  findings: [],
  disputes: [],
  coverage: null,
  marks: [],
  ...over,
});

/** Oldest → newest, the order a replay carries. */
const thread = (...answers: (ReviewNote | null)[]): ReviewRow[] =>
  answers.flatMap((review, i) => [
    { role: "user", content: `question ${i}` },
    { role: "assistant", content: `Answer number ${i} about the Stability Scope and its rates.`, review },
  ]);

const body = (round: ReturnType<typeof reviewRound>): string => {
  const toolMsg = round[1];
  if (!toolMsg || toolMsg.role !== "tool") throw new Error("expected a tool message");
  return String(toolMsg.content);
};

describe("reviewRound", () => {
  it("returns [] when nothing carries a note — the common case", () => {
    expect(reviewRound([])).toEqual([]);
    expect(reviewRound(thread(null, null))).toEqual([]);
    // User rows can never carry one.
    expect(reviewRound([{ role: "user", content: "hi" }])).toEqual([]);
  });

  it("emits an assistant tool_call followed by a tool result with a matching id", () => {
    const round = reviewRound(thread(note()));
    expect(round).toHaveLength(2);
    const [assistantMsg, toolMsg] = round;
    expect(assistantMsg.role).toBe("assistant");
    if (assistantMsg.role !== "assistant" || !("tool_calls" in assistantMsg) || !assistantMsg.tool_calls) {
      throw new Error("expected tool_calls");
    }
    expect(assistantMsg.content).toBeNull();
    expect(assistantMsg.tool_calls).toHaveLength(1);
    const call = assistantMsg.tool_calls[0]!;
    if (call.type !== "function") throw new Error("expected function tool call");
    expect(call.function.name).toBe(REVIEW_TOOL_NAME);
    expect(toolMsg.role).toBe("tool");
    if (toolMsg.role !== "tool") throw new Error("expected tool");
    expect(toolMsg.tool_call_id).toBe(call.id);
  });

  it("frames the results as checks, not rulings, with the pronoun-antecedent caution kept", () => {
    // Inherited verbatim from the dispute round this replaces — the framing was
    // the hard-won part, written because a flag in the originating bug report was
    // itself likely wrong.
    const content = body(reviewRound(thread(note())));
    expect(content).toContain("These are check results, not rulings, and not retrieved evidence.");
    expect(content).toContain("pronoun antecedents");
    expect(content).toContain("atlas_get");
    expect(content).toContain("Do not restate a flagged sentence unchanged.");
  });

  it("says what it is: results the user saw, and that unlisted answers were clean", () => {
    const content = body(reviewRound(thread(note())));
    expect(content).toContain("shown to the user");
    expect(content).toMatch(/not listed below showed a\s+passing badge, or no badge at all/);
  });

  describe("the newest answer", () => {
    it("gets the full block: badge, findings, disputes, coverage and marks", () => {
      const content = body(reviewRound(thread(note({
        badge: "1 statement disputed by the atlas",
        findings: ["quote not found in any retrieved source: “a quote”"],
        disputes: [c()],
        coverage: "declined to answer",
        marks: ["doc 76405733 marked disputed"],
      }))));
      expect(content).toContain("Badge: 1 statement disputed by the atlas");
      expect(content).toContain(" - quote not found in any retrieved source: “a quote”");
      expect(content).toContain("1. Your sentence:");
      expect(content).toContain("Source document: 76405733-0000-0000-0000-000000000000");
      expect(content).toContain("Coverage: declined to answer");
      expect(content).toContain("Citations: doc 76405733 marked disputed");
    });

    it("is anchored by position plus the opening of its own text, never a message id", () => {
      // ReplayRow.id exists only as the compaction cursor and never reaches the
      // model; an ordinal plus a lead survives compaction and needs no new id.
      const content = body(reviewRound(thread(note())));
      expect(content).toContain("[Latest answer — begins “Answer number 0 about the Stability Scope");
    });

    it("caps the disputes it shows", () => {
      const content = body(reviewRound(thread(note({ disputes: [c(), c(), c(), c(), c()] }))));
      expect(content).toContain(`${MAX_DISPUTES}. Your sentence:`);
      expect(content).not.toContain(`${MAX_DISPUTES + 1}. Your sentence:`);
    });

    it("truncates a long span, as the dispute round did", () => {
      const long = "x".repeat(500);
      const content = body(reviewRound(thread(note({ disputes: [c({ answer: long, evidence: long })] }))));
      expect(content).not.toContain(long);
      expect(content).toContain(`${"x".repeat(300)}…`);
    });

    it("omits the Source document line when uuid is null", () => {
      const content = body(reviewRound(thread(note({ disputes: [c({ uuid: null })] }))));
      expect(content).not.toContain("Source document:");
    });
  });

  describe("older answers", () => {
    it("get one short digest line, not a block", () => {
      // thread() is oldest-first, so the LAST entry is the newest answer.
      const content = body(reviewRound(thread(note({ badge: "caution: the answer issues a ruling" }), note())));
      expect(content).toContain("[2 answers earlier — begins “Answer number 0");
      expect(content).toContain("caution: the answer issues a ruling");
      // The older one contributes no dispute entries, however many it carries.
      const withDisputes = body(reviewRound(thread(note({ disputes: [c(), c()] }), note())));
      expect(withDisputes).not.toContain("2. Your sentence:");
    });

    it("are clipped to the digest cap", () => {
      const long = "y".repeat(600);
      const content = body(reviewRound(thread(note({ findings: [long] }), note())));
      const digest = content.split("\n").find((l) => l.startsWith("[2 answers earlier"))!;
      expect(digest.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS);
    });

    it("are not shown at all beyond the lookback", () => {
      const many = Array.from({ length: REVIEW_LOOKBACK + 5 }, () => note());
      const content = body(reviewRound(thread(...many)));
      expect(content).not.toContain(`[${REVIEW_LOOKBACK + 1} answers earlier`);
    });
  });

  it("stays within the total cap, dropping the OLDEST digests to fit", () => {
    // The budget only binds when the newest block is near its own 5k cap AND
    // every older answer carries a digest: 12 digests alone come to ~2.9k, well
    // under the total. So the newest note is made maximal on purpose.
    const fat = () => note({ findings: Array.from({ length: 6 }, (_, i) => `finding ${i} ${"z".repeat(150)}`), marks: ["doc 11111111 marked unread"] });
    const huge = note({ findings: Array.from({ length: 60 }, (_, i) => `finding ${i} ${"w".repeat(150)}`) });
    const many = [...Array.from({ length: REVIEW_LOOKBACK - 1 }, fat), huge];
    const content = body(reviewRound(thread(...many)));
    expect(content.length).toBeLessThanOrEqual(REVIEW_ROUND_MAX_CHARS);
    // The newest block and the fixed text always survive.
    expect(content).toContain("[Latest answer — begins");
    expect(content).toContain("Do not restate a flagged sentence unchanged.");
    // The oldest digest is the one that went.
    expect(content).not.toContain(`[${REVIEW_LOOKBACK} answers earlier`);
  });

  it("is O(1) in thread length — a long clean thread costs nothing", () => {
    const long = thread(...Array.from({ length: 60 }, () => null));
    expect(reviewRound(long)).toEqual([]);
  });
});

describe("isReviewRound", () => {
  // Four consumers must not treat this round as evidence, and they match on
  // different things — a tool NAME (verifier.ts) or a call ID (tool-recall.ts,
  // toolTextsOf, exportEvidence). One predicate answers both.
  it("matches the tool name and the call id, and nothing else", () => {
    expect(isReviewRound(REVIEW_TOOL_NAME)).toBe(true);
    expect(isReviewRound(REVIEW_TOOL_ID)).toBe(true);
    expect(isReviewRound("atlas_get")).toBe(false);
    expect(isReviewRound("call_prefetch")).toBe(false);
    expect(isReviewRound(undefined)).toBe(false);
  });
});
