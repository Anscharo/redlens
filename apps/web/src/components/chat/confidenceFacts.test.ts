import { describe, expect, it } from "vitest";
import { answerFacts, disputedMarksText, missingPartsText } from "./confidenceFacts";
import type { CitationMark } from "./api";

const mark = (status: CitationMark["status"]): CitationMark => ({ status, claims: [] });

describe("answerFacts", () => {
  it("says nothing when no ruling and no marks arrived", () => {
    expect(answerFacts(undefined, undefined)).toEqual([]);
    expect(answerFacts(undefined, {})).toEqual([]);
  });

  it("says nothing extra for a plain `answers` ruling", () => {
    expect(answerFacts({ verdict: "answers", missingParts: [] }, undefined)).toEqual([]);
  });

  it("flags a non-answer", () => {
    expect(answerFacts({ verdict: "deflects", missingParts: [] }, undefined)).toEqual([
      { key: "coverage", text: "Didn't answer the question", status: "flagged" },
    ]);
  });

  it("states a clarifying question and a decline as neutral facts", () => {
    expect(answerFacts({ verdict: "asks", missingParts: [] }, undefined)).toEqual([
      { key: "coverage", text: "Asked you a clarifying question", status: "info" },
    ]);
    expect(answerFacts({ verdict: "declines", missingParts: [] }, undefined)).toEqual([
      { key: "coverage", text: "Said the atlas doesn't cover this", status: "info" },
    ]);
  });

  it("names the parts an answer skipped, quoted", () => {
    expect(answerFacts({ verdict: "answers", missingParts: ["when"] }, undefined)).toEqual([
      { key: "missing", text: "Didn't address: “when”", status: "flagged" },
    ]);
    expect(missingPartsText(["how much", "when"])).toBe("Didn't address: “how much”, “when”");
  });

  it("never lists parts under a non-answer, even if some were sent", () => {
    const facts = answerFacts({ verdict: "deflects", missingParts: ["when"] }, undefined);
    expect(facts.map((f) => f.key)).toEqual(["coverage"]);
  });

  it("says nothing for sure matches and for marks the chip does not draw", () => {
    expect(answerFacts(undefined, { a: mark("backed"), b: mark("backed"), c: mark("uncovered") })).toEqual([]);
    expect(answerFacts(undefined, { a: mark("backed_weak"), b: mark("unread") })).toEqual([]);
  });

  it("flags the line when a marked citation is disputed, and ignores marks the chip does not draw", () => {
    const marks = { a: mark("backed"), b: mark("uncovered"), c: mark("disputed") };
    expect(answerFacts(undefined, marks)).toEqual([{ key: "sources", text: "A marked citation may say otherwise", status: "flagged" }]);
    expect(answerFacts(undefined, { a: mark("disputed"), b: mark("disputed") })).toEqual([
      { key: "sources", text: "2 marked citations may say otherwise", status: "flagged" },
    ]);
  });

  it("agrees number in the citations fact", () => {
    expect(disputedMarksText(1)).toBe("A marked citation may say otherwise");
    expect(disputedMarksText(2)).toBe("2 marked citations may say otherwise");
  });

  it("orders coverage, then missing parts, then sources", () => {
    const facts = answerFacts({ verdict: "declines", missingParts: ["for which chains"] }, { a: mark("disputed") });
    expect(facts.map((f) => f.key)).toEqual(["coverage", "missing", "sources"]);
  });
});
