import { describe, expect, it } from "vitest";
import { answerFacts, missingPartsText, sourcesText } from "./confidenceFacts";
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

  it("counts checked citations and how many are backed", () => {
    const marks = { a: mark("backed"), b: mark("backed"), c: mark("uncovered") };
    expect(answerFacts(undefined, marks)).toEqual([{ key: "sources", text: "2 of 3 checked citations are backed", status: "info" }]);
  });

  it("flags the citations count when a checked citation is disputed", () => {
    const marks = { a: mark("backed"), b: mark("uncovered"), c: mark("disputed") };
    expect(answerFacts(undefined, marks)).toEqual([{ key: "sources", text: "1 of 3 checked citations is backed", status: "flagged" }]);
  });

  it("agrees number in the citations fact", () => {
    expect(sourcesText(1, 1)).toBe("1 of 1 checked citation is backed");
    expect(sourcesText(1, 3)).toBe("1 of 3 checked citations is backed");
    expect(sourcesText(0, 2)).toBe("0 of 2 checked citations are backed");
  });

  it("orders coverage, then missing parts, then sources", () => {
    const facts = answerFacts({ verdict: "declines", missingParts: ["for which chains"] }, { a: mark("backed") });
    expect(facts.map((f) => f.key)).toEqual(["coverage", "missing", "sources"]);
  });
});
