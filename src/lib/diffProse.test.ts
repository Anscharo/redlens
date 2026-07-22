import { describe, it, expect } from "vitest";
import { refineProseDiff } from "./diffProse";
import { wordDiff } from "./diffCore";
import type { DiffLine, WordSegment } from "./history";

function tildeInput(oldLine: string, newLine: string): DiffLine[] {
  return [["~", wordDiff(oldLine, newLine)]];
}

describe("refineProseDiff", () => {
  it("keeps a small single-word edit word-level, with untouched sentences as '=' context", () => {
    const s1 = "Sentence one is fine.";
    const s2old = "Sentence two mentions Alpha.";
    const s2new = "Sentence two mentions Beta.";
    const s3 = "Sentence three closes it.";
    const oldLine = [s1, s2old, s3].join(" ");
    const newLine = [s1, s2new, s3].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    expect(segs.some(([op, t]) => op === "-" && t.includes("Alpha"))).toBe(true);
    expect(segs.some(([op, t]) => op === "+" && t.includes("Beta"))).toBe(true);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Sentence one is fine."))).toBe(true);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Sentence three closes it."))).toBe(true);
  });

  it("promotes one scattered rewrite among three sentences to a whole-sentence block, with '=' context around", () => {
    const s1 = "Intro stays the same.";
    const s2old = "Alpha handles the vault and reports to Bravo for review.";
    const s2new = "Zulu handles the pool and reports to Yankee for audit.";
    const s3 = "Closing stays the same too.";
    const oldLine = [s1, s2old, s3].join(" ");
    const newLine = [s1, s2new, s3].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    // Non-last sentences carry a trailing space attached by segmentSentences.
    expect(segs.some(([op, t]) => op === "-" && t.trim() === s2old)).toBe(true);
    expect(segs.some(([op, t]) => op === "+" && t.trim() === s2new)).toBe(true);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Intro stays the same."))).toBe(true);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Closing stays the same too."))).toBe(true);
  });

  it("promotes a whole paragraph rewrite (no shared vocabulary at all) to before/after blocks", () => {
    const oldLine = "Alpha handles vault deposits nightly!";
    const newLine = "Zulu processes pool withdrawals hourly?";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toEqual([
      ["-", oldLine],
      ["+", newLine],
    ]);
  });

  it("leaves a structured table-row diff untouched", () => {
    const input = tildeInput("| a | b |", "| a | c |");
    expect(refineProseDiff(input)).toEqual(input);
  });

  it("leaves a structured key:value line diff untouched", () => {
    const input = tildeInput("Budget: 100 USDS", "Budget: 200 USDS");
    expect(refineProseDiff(input)).toEqual(input);
  });

  it("shows a mid-paragraph sentence insertion as a single '+' segment with '=' neighbors", () => {
    const s1 = "First sentence stays.";
    const s2new = "New sentence inserted here.";
    const s3 = "Third sentence stays too.";
    const oldLine = [s1, s3].join(" ");
    const newLine = [s1, s2new, s3].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    const plusSegs = segs.filter(([op]) => op === "+");
    expect(plusSegs).toHaveLength(1);
    expect(plusSegs[0][1]).toContain("New sentence inserted here.");
    expect(segs.some(([op, t]) => op === "=" && t.includes("First sentence stays."))).toBe(true);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Third sentence stays too."))).toBe(true);
  });

  it("keeps a punctuation-only change word-level", () => {
    const oldLine = "Update the value, then confirm.";
    const newLine = "Update the value; then confirm.";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    expect(segs.some(([op, t]) => op === "-" && t.includes(","))).toBe(true);
    expect(segs.some(([op, t]) => op === "+" && t.includes(";"))).toBe(true);
  });

  it("promotes a scattered single-sentence paraphrase (>=2 runs, ratio > 0.22) to whole-sentence replacement", () => {
    const oldLine = "Alpha handles the vault and reports to Bravo for review.";
    const newLine = "Zulu handles the pool and reports to Yankee for audit.";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toEqual([
      ["-", oldLine],
      ["+", newLine],
    ]);
  });

  it("coalesces two adjacent rewritten sentences into one '-' block then one '+' block (no alternation)", () => {
    const s1 = "Intro remains constant.";
    const s2old = "Alpha handles the vault and reports to Bravo for review.";
    const s2new = "Zulu handles the pool and reports to Yankee for audit.";
    const s3old = "Gamma also assists the desk and notifies Delta for closing.";
    const s3new = "Omega also assists the floor and notifies Sigma for opening.";
    const oldLine = [s1, s2old, s3old].join(" ");
    const newLine = [s1, s2new, s3new].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    const nonEqualOps = segs.filter(([op]) => op !== "=").map(([op]) => op);
    expect(nonEqualOps).toEqual(["-", "+"]);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Intro remains constant."))).toBe(true);
  });

  it("returns the original entry unchanged for a whitespace-only diff between sentences", () => {
    const oldLine = "First sentence ends here.  Second sentence follows.";
    const newLine = "First sentence ends here. Second sentence follows.";
    const input = tildeInput(oldLine, newLine);

    expect(refineProseDiff(input)).toEqual(input);
  });

  it("passes through '=', '+', '-', and gap lines unchanged", () => {
    const lines: DiffLine[] = [["=", "x"], ["+", "x"], ["-", "x"], ["…"]];
    expect(refineProseDiff(lines)).toEqual(lines);
  });

  it("passes through a malformed '~' entry unchanged", () => {
    const malformed = [["~", "not-an-array"]] as unknown as DiffLine[];
    expect(refineProseDiff(malformed)).toEqual(malformed);
  });

  it("returns [] for non-array input", () => {
    expect(refineProseDiff(undefined as unknown as DiffLine[])).toEqual([]);
  });

  it("preserves exact reconstruction ('='+'-' -> oldLine, '='+'+' -> newLine) for a non-promoted refinement", () => {
    const s1 = "Sentence one is fine.";
    const s2old = "Sentence two mentions Alpha.";
    const s2new = "Sentence two mentions Beta.";
    const s3 = "Sentence three closes it.";
    const oldLine = [s1, s2old, s3].join(" ");
    const newLine = [s1, s2new, s3].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    const rebuiltOld = segs
      .filter(([op]) => op === "=" || op === "-")
      .map(([, t]) => t)
      .join("");
    const rebuiltNew = segs
      .filter(([op]) => op === "=" || op === "+")
      .map(([, t]) => t)
      .join("");
    expect(rebuiltOld).toBe(oldLine);
    expect(rebuiltNew).toBe(newLine);
  });

  it("promotes a big shared-prefix rewrite even though it's a single contiguous run (promotion is ratio-driven, not run-driven)", () => {
    // Shared prefix, then the rest fully replaced as one contiguous run
    // (single differing token on each side, so no internal whitespace anchor
    // splits it into multiple runs). Both sides change and ratio > 0.22, so
    // this must promote regardless of run count.
    const oldLine = "The vault accepts USDSDepositsFromAnyAuthorizedHolder";
    const newLine = "The vault accepts TotallyDifferentWithdrawalAmountsRightNow";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toEqual([
      ["-", oldLine],
      ["+", newLine],
    ]);
  });

  it("keeps a small multi-word edit (ratio <= 0.22) word-level even though it's a single run", () => {
    const oldLine =
      "The vault accepts stable value deposits from any authorized account holder for standard daily operations across every supported network today";
    const newLine =
      "The vault accepts digital currency deposits from any authorized account holder for standard daily operations across every supported network today";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
  });

  it("keeps a purely-appended long clause word-level (added-only never promotes, even above the ratio threshold)", () => {
    const oldLine = "The vault processes payments daily";
    const appended =
      "and now also reconciles balances automatically every night without any manual intervention required";
    const newLine = `${oldLine} ${appended}`;

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    expect(segs.filter(([op]) => op === "-")).toHaveLength(0);
    const plusSegs = segs.filter(([op]) => op === "+");
    expect(plusSegs).toHaveLength(1);
    expect(plusSegs[0][1]).toContain(appended);
  });

  it("keeps a contiguous edit between RATIO_SCATTERED and RATIO_CONTIG word-level (the dual bar)", () => {
    // ratio 0.2857 — above the old single 0.22 threshold but below the
    // higher RATIO_CONTIG bar a single contiguous run now gets.
    const oldLine = "The vault accepts Bronze";
    const newLine = "The vault accepts Silver";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
  });

  it("keeps a scattered edit well under RATIO_SCATTERED word-level", () => {
    // Two single-word swaps far apart in a long sentence: runs=2 (scattered)
    // but ratio ~0.11, well under the 0.22 bar.
    const oldLine =
      "The vault accepts stable deposits from any authorized account holder for standard daily operations across every supported network without exception today";
    const newLine =
      "The vault accepts digital deposits from any authorized account holder for standard daily operations across every approved network without exception today";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
  });

  it("island absorption: a short common word mid-region displays as one contiguous -/+ block without promoting", () => {
    // "the" is a MAX_ISLAND-sized accidental match between two changed
    // clauses. Pre-absorption stats (genuine ratio ~0.29, runs=2) don't clear
    // RATIO_SCATTERED; post-absorption runs=1 (one contiguous block), and
    // that ratio (~0.29) doesn't clear RATIO_CONTIG either — so this stays
    // word-level. If the island's chars had leaked into the ratio via the
    // post-absorption count (~0.35) instead, this WOULD promote — so staying
    // "~" is itself proof the promotion ratio excludes the island's chars.
    const oldLine = "AlphaVal the BravoVal from the standard workflow always applies";
    const newLine = "ZuluVal the YankeeVal from the standard workflow always applies";

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    const minusSegs = segs.filter(([op]) => op === "-");
    const plusSegs = segs.filter(([op]) => op === "+");
    expect(minusSegs).toHaveLength(1);
    expect(plusSegs).toHaveLength(1);
    expect(minusSegs[0][1]).toBe("AlphaVal the BravoVal");
    expect(plusSegs[0][1]).toBe("ZuluVal the YankeeVal");
    // Reconstruction still holds through the absorbed display.
    const rebuiltOld = segs.filter(([op]) => op === "=" || op === "-").map(([, t]) => t).join("");
    const rebuiltNew = segs.filter(([op]) => op === "=" || op === "+").map(([, t]) => t).join("");
    expect(rebuiltOld).toBe(oldLine);
    expect(rebuiltNew).toBe(newLine);
  });

  it("promotes the whole paragraph when genuinely scattered (two non-adjacent rewritten sentences)", () => {
    // Two SEPARATE promoted sentences with unchanged context between them:
    // paragraph-level runs=2 (scattered), ratio well above RATIO_SCATTERED.
    // Contrast with the single/adjacent-promotion tests above, which stay
    // inline (paragraph runs=1) even at a much higher ratio.
    const s1 = "Intro remains constant.";
    const s2old = "Alpha handles the vault and reports to Bravo for review.";
    const s2new = "Zulu handles the pool and reports to Yankee for audit.";
    const s3 = "Middle stays fixed too.";
    const s4old = "Gamma also assists the desk and notifies Delta for closing.";
    const s4new = "Omega also assists the floor and notifies Sigma for opening.";
    const oldLine = [s1, s2old, s3, s4old].join(" ");
    const newLine = [s1, s2new, s3, s4new].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toEqual([
      ["-", oldLine],
      ["+", newLine],
    ]);
  });

  it("keeps a one-character enumerator restyle ('1)' -> '1.') as the stored word diff (near-noise floor)", () => {
    // Regression: the enumerator period made segmentSentences split the new
    // side ("1. Deploy..." -> ["1. ", "Deploy..."]), and the resulting 1:2
    // sentence pairing promoted a 1-char edit to a full-line swap.
    const oldLine = "1) Deploy infrastructure to enable initial allocation conduits;";
    const newLine = "1. Deploy infrastructure to enable initial allocation conduits;";
    const input = tildeInput(oldLine, newLine);
    expect(refineProseDiff(input)).toEqual(input);
  });

  it("never promotes below the near-noise floor, whatever the sentence split does", () => {
    const oldLine = "4) Develop transparent insights into the allocation of the balance sheet.";
    const newLine = "4. Develop transparent insights into the allocation of the balance sheet.";
    const input = tildeInput(oldLine, newLine);
    expect(refineProseDiff(input)).toEqual(input);
  });

  it("end-to-end: a promoted sentence with a shared comma clause renders the clause as '=' inside the paragraph, not a whole-sentence swap", () => {
    const s1 = "Intro stays the same.";
    const s2old = "The Facilitator, acting in good faith, must approve the deposit request.";
    const s2new = "The Custodian, acting in good faith, must reject the withdrawal notice.";
    const s3 = "Closing stays the same too.";
    const oldLine = [s1, s2old, s3].join(" ");
    const newLine = [s1, s2new, s3].join(" ");

    const result = refineProseDiff(tildeInput(oldLine, newLine));
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe("~");
    const segs = result[0][1] as WordSegment[];
    // The shared subclause survives as plain text — not struck and re-added.
    expect(segs).toContainEqual(["=", "acting in good faith, "]);
    expect(segs.some(([op, t]) => op === "-" && t.trim() === "The Facilitator,")).toBe(true);
    expect(segs.some(([op, t]) => op === "+" && t.trim() === "The Custodian,")).toBe(true);
    // Paragraph-level context sentences are still untouched "=" segments.
    expect(segs.some(([op, t]) => op === "=" && t.includes("Intro stays the same."))).toBe(true);
    expect(segs.some(([op, t]) => op === "=" && t.includes("Closing stays the same too."))).toBe(true);
    const rebuiltOld = segs.filter(([op]) => op === "=" || op === "-").map(([, t]) => t).join("");
    const rebuiltNew = segs.filter(([op]) => op === "=" || op === "+").map(([, t]) => t).join("");
    expect(rebuiltOld).toBe(oldLine);
    expect(rebuiltNew).toBe(newLine);
  });
});
