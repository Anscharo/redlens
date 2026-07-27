import { describe, it, expect } from "vitest";
import {
  segmentSentences,
  segmentSubclauses,
  isStructuredLine,
  changeStats,
  shouldPromote,
  RATIO_SCATTERED,
  RATIO_CONTIG,
} from "./diffSentences";
import type { WordSegment } from "./history";

describe("segmentSentences", () => {
  const sampleLines = [
    "This is one. This is two.",
    "We saw examples, e.g. Something changed here.",
    "Weird   spacing.   Another one follows.",
    "",
    "No terminal punctuation here",
    "Dr. Smith arrived. Then left quickly.",
    "A single letter initial like J. Appleseed signed it.",
  ];

  it("is always lossless: joining the sentences reconstructs the original line exactly", () => {
    for (const line of sampleLines) {
      expect(segmentSentences(line).join("")).toBe(line);
    }
  });

  it("splits a plain two-sentence line into two sentences", () => {
    expect(segmentSentences("This is one. This is two.")).toEqual([
      "This is one. ",
      "This is two.",
    ]);
  });

  it("does not split at a known abbreviation like e.g.", () => {
    expect(segmentSentences("We saw examples, e.g. Something changed here.")).toHaveLength(1);
  });

  it("does not split at a single capital-letter initial", () => {
    expect(segmentSentences("A single letter initial like J. Appleseed signed it.")).toHaveLength(1);
  });

  it("does not split at a 1-2 digit list enumerator like '1.'", () => {
    expect(segmentSentences("1. Deploy infrastructure to enable conduits;")).toHaveLength(1);
    expect(segmentSentences("12. Establish manual reallocation processes; and")).toHaveLength(1);
  });

  it("still splits after a year-like number ending a sentence", () => {
    expect(segmentSentences("The plan launched in 2024. Next phase begins soon.")).toHaveLength(2);
  });
});

describe("segmentSubclauses", () => {
  const sampleSentences = [
    "Alpha, Bravo, Charlie.",
    "The Facilitator (acting alone) must act.",
    "1,000 USDS, more text",
    "No delimiters here at all",
    "",
    "Trailing comma at the end,",
    "An unclosed paren (never ends",
    "Alpha; Bravo; Charlie",
  ];

  it("is always lossless: joining the subclauses reconstructs the original sentence exactly", () => {
    for (const s of sampleSentences) {
      expect(segmentSubclauses(s).join("")).toBe(s);
    }
  });

  it("splits on commas, attaching the delimiter and trailing whitespace to the preceding unit", () => {
    expect(segmentSubclauses("Alpha, Bravo, Charlie.")).toEqual(["Alpha, ", "Bravo, ", "Charlie."]);
  });

  it("splits on semicolons the same way", () => {
    expect(segmentSubclauses("Alpha; Bravo")).toEqual(["Alpha; ", "Bravo"]);
  });

  it("treats a parenthetical as one standalone unit", () => {
    expect(segmentSubclauses("The Facilitator (acting alone) must act.")).toEqual([
      "The Facilitator ",
      "(acting alone)",
      " must act.",
    ]);
  });

  it("does not split inside a number like '1,000'", () => {
    expect(segmentSubclauses("1,000 USDS, more text")).toEqual(["1,000 USDS, ", "more text"]);
  });

  it("returns the whole sentence as one unit when there is nothing to split on", () => {
    expect(segmentSubclauses("No delimiters here at all")).toEqual(["No delimiters here at all"]);
  });
});

describe("isStructuredLine", () => {
  it("flags a table row", () => {
    expect(isStructuredLine("| Column A | Column B |")).toBe(true);
  });

  it("flags a heading", () => {
    expect(isStructuredLine("## A heading")).toBe(true);
  });

  it("flags a code fence", () => {
    expect(isStructuredLine("```solidity")).toBe(true);
  });

  it("flags indented (4-space) code", () => {
    expect(isStructuredLine("    const x = 1;")).toBe(true);
  });

  it("flags a key:value line with no internal sentence punctuation", () => {
    expect(isStructuredLine("Budget: 100 USDS")).toBe(true);
  });

  it("flags a symbol-dense line", () => {
    expect(isStructuredLine("!!!@@@###$$$%%%^^^")).toBe(true);
  });

  it("does not flag ordinary prose", () => {
    expect(isStructuredLine("The Prime Agent notifies GovOps of the change.")).toBe(false);
  });

  it("does not flag multi-sentence prose that happens to start with a Word: prefix", () => {
    expect(
      isStructuredLine("Note: this sentence continues normally. It still reads as prose overall."),
    ).toBe(false);
  });
});

describe("changeStats", () => {
  it("returns ratio 0 and runs 0 for an all-equal segment set", () => {
    expect(changeStats([["=", "unchanged text"]])).toEqual({
      ratio: 0,
      runs: 0,
      removed: 0,
      added: 0,
    });
  });

  it("counts a single contiguous -/+ pair as one run", () => {
    const stats = changeStats([
      ["=", "a "],
      ["-", "b"],
      ["+", "c"],
      ["=", " d"],
    ]);
    expect(stats.runs).toBe(1);
  });

  it("counts two separated -/+ pairs as two runs", () => {
    const stats = changeStats([
      ["=", "a "],
      ["-", "b"],
      ["+", "c"],
      ["=", " mid "],
      ["-", "d"],
      ["+", "e"],
      ["=", " f"],
    ]);
    expect(stats.runs).toBe(2);
  });

  it("ignores whitespace-only segments when computing the ratio", () => {
    const stats = changeStats([
      ["=", "Alpha"],
      ["-", "  "],
      ["+", " "],
      ["=", "Beta"],
    ]);
    expect(stats.ratio).toBe(0);
  });

  it("returns ratio 0, removed 0, added 0 for a spacing-only change (double space -> single space)", () => {
    const stats = changeStats([
      ["=", "Alpha"],
      ["-", "  "],
      ["+", " "],
      ["=", "Beta"],
    ]);
    expect(stats).toEqual({ ratio: 0, runs: 0, removed: 0, added: 0 });
  });

  it("counts two changed words separated only by an unchanged space as one run", () => {
    // A whitespace-only "=" between two changed regions is transparent — it
    // does not separate them, since visually they read as one changed block.
    const stats = changeStats([
      ["-", "old1"],
      ["+", "new1"],
      ["=", " "],
      ["-", "old2"],
      ["+", "new2"],
    ]);
    expect(stats.runs).toBe(1);
  });

  it("counts two changed words separated by an unchanged word as two runs", () => {
    // An "=" with real (non-whitespace) content genuinely separates the
    // surrounding changed regions into two runs.
    const stats = changeStats([
      ["-", "old1"],
      ["+", "new1"],
      ["=", " middle "],
      ["-", "old2"],
      ["+", "new2"],
    ]);
    expect(stats.runs).toBe(2);
  });

  it("computes the ratio from non-whitespace characters only, matching hand-computed counts", () => {
    // 10-word sentence, 2 words changed ("three"->"THREE", "seven"->"SEVEN").
    const segs: WordSegment[] = [
      ["=", "one two "],
      ["-", "three"],
      ["+", "THREE"],
      ["=", " four five six "],
      ["-", "seven"],
      ["+", "SEVEN"],
      ["=", " eight nine ten"],
    ];
    const stats = changeStats(segs);
    // nonws: "onetwo"=6, "fourfivesix"=11, "eightnineten"=12 -> 29 unchanged
    // chars per side; removed="three"+"seven"=10, added="THREE"+"SEVEN"=10.
    // oldLen = newLen = 29 + 10 = 39; ratio = (10+10) / (39+39) = 10/39.
    expect(stats.removed).toBe(10);
    expect(stats.added).toBe(10);
    expect(stats.runs).toBe(2);
    expect(stats.ratio).toBeCloseTo(10 / 39, 10);
  });
});

describe("shouldPromote", () => {
  it("never promotes a purely-inserted change (removed 0), regardless of ratio or runs", () => {
    expect(shouldPromote({ ratio: 0.99, runs: 3, removed: 0, added: 50 })).toBe(false);
  });

  it("never promotes a purely-deleted change (added 0), regardless of ratio or runs", () => {
    expect(shouldPromote({ ratio: 0.99, runs: 3, removed: 50, added: 0 })).toBe(false);
  });

  it("never promotes when runs is 0 (no real change)", () => {
    expect(shouldPromote({ ratio: 0, runs: 0, removed: 0, added: 0 })).toBe(false);
  });

  it("contiguous (runs 1) at or below RATIO_CONTIG stays inline", () => {
    expect(shouldPromote({ ratio: RATIO_CONTIG, runs: 1, removed: 5, added: 5 })).toBe(false);
    expect(shouldPromote({ ratio: RATIO_CONTIG - 0.01, runs: 1, removed: 5, added: 5 })).toBe(false);
  });

  it("contiguous (runs 1) above RATIO_CONTIG promotes", () => {
    expect(shouldPromote({ ratio: RATIO_CONTIG + 0.01, runs: 1, removed: 5, added: 5 })).toBe(true);
  });

  it("contiguous (runs 1) between RATIO_SCATTERED and RATIO_CONTIG stays inline — the dual bar", () => {
    // Would have promoted under a single 0.22 threshold; a contiguous run
    // gets the higher RATIO_CONTIG bar instead.
    const ratio = (RATIO_SCATTERED + RATIO_CONTIG) / 2;
    expect(shouldPromote({ ratio, runs: 1, removed: 5, added: 5 })).toBe(false);
  });

  it("scattered (runs >= 2) at or below RATIO_SCATTERED stays inline", () => {
    expect(shouldPromote({ ratio: RATIO_SCATTERED, runs: 2, removed: 5, added: 5 })).toBe(false);
  });

  it("scattered (runs >= 2) above RATIO_SCATTERED promotes", () => {
    expect(shouldPromote({ ratio: RATIO_SCATTERED + 0.01, runs: 2, removed: 5, added: 5 })).toBe(true);
  });
});
