import { describe, expect, it } from "vitest";
import { matchKeywords, findCandidates } from "./process-keywords.mjs";

describe("matchKeywords", () => {
  it("matches a single-word keyword case-insensitively on word boundaries", () => {
    expect(matchKeywords("The Ratification Process")).toEqual(["ratification"]);
    // Substrings of larger words must not match ("processing" is not "process").
    expect(matchKeywords("Data Processing Agreement")).toEqual([]);
  });

  it("preserves the classifier's first-single-word-hit behavior", () => {
    expect(matchKeywords("Escalation and Termination")).toEqual(["escalation"]);
  });

  it("dedupes a keyword that appears twice", () => {
    expect(matchKeywords("Cycle after cycle")).toEqual(["cycle"]);
  });

  it("matches multi-word keywords by substring", () => {
    expect(matchKeywords("Quarterly Review Period Rules")).toEqual(["review period"]);
  });

  it("returns [] for empty and keyword-free titles", () => {
    expect(matchKeywords("")).toEqual([]);
    expect(matchKeywords("Treasury Overview")).toEqual([]);
  });
});

describe("findCandidates", () => {
  const docs = {
    a: { title: "Budget Cycle", type: "Section" },
    b: { title: "Escalation and Termination", type: "Core", parentId: "a" },
    c: { title: "Budget Cycle", type: "Active Data" }, // NON_PROCESS_TYPES → skipped
    d: { title: "Treasury Overview", type: "Section" }, // no keywords → skipped
  };

  it("returns keyworded docs, filtering non-process types and keyword-free titles", () => {
    const ids = findCandidates(docs).map((c) => c.id);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("carries the first matched single-word keyword on the candidate row", () => {
    const b = findCandidates(docs).find((c) => c.id === "b");
    expect(b?.keywords).toEqual(["escalation"]);
  });

  it("skips descendants of excluded ancestors", () => {
    const ids = findCandidates(docs, ["a"]).map((c) => c.id);
    expect(ids).toEqual(["a"]); // b is a child of a; a itself stays
  });
});
