import { describe, it, expect } from "vitest";
import { refineSentencePair } from "./diffSubclause";
import type { WordSegment } from "@/lib/history";

function reconstruct(segs: WordSegment[]): { old: string; new: string } {
  return {
    old: segs.filter(([op]) => op === "=" || op === "-").map(([, t]) => t).join(""),
    new: segs.filter(([op]) => op === "=" || op === "+").map(([, t]) => t).join(""),
  };
}

describe("refineSentencePair", () => {
  it("stays word-level (fullSwap false) when the pair doesn't earn promotion", () => {
    const oldSent = "Sentence two mentions Alpha.";
    const newSent = "Sentence two mentions Beta.";
    const result = refineSentencePair(oldSent, newSent);

    expect(result.fullSwap).toBe(false);
    expect(result.segs.some(([op, t]) => op === "-" && t.includes("Alpha"))).toBe(true);
    expect(result.segs.some(([op, t]) => op === "+" && t.includes("Beta"))).toBe(true);
  });

  it("falls back to a genuine whole-sentence swap when the two sentences share no subclause", () => {
    const oldSent = "Alpha handles the vault and reports to Bravo for review.";
    const newSent = "Zulu handles the pool and reports to Yankee for audit.";
    const result = refineSentencePair(oldSent, newSent);

    expect(result).toEqual({
      segs: [
        ["-", oldSent],
        ["+", newSent],
      ],
      fullSwap: true,
    });
  });

  it("keeps an identical middle comma clause as '=' while changed subclauses swap, and does not report fullSwap", () => {
    const oldSent = "The Facilitator, acting in good faith, must approve the deposit request.";
    const newSent = "The Custodian, acting in good faith, must reject the withdrawal notice.";
    const result = refineSentencePair(oldSent, newSent);

    expect(result.fullSwap).toBe(false);
    expect(result.segs).toContainEqual(["=", "acting in good faith, "]);
    expect(result.segs.some(([op, t]) => op === "-" && t.trim() === "The Facilitator,")).toBe(true);
    expect(result.segs.some(([op, t]) => op === "+" && t.trim() === "The Custodian,")).toBe(true);
    expect(reconstruct(result.segs)).toEqual({ old: oldSent, new: newSent });
  });

  it("keeps an identical parenthetical as '=' while the surrounding text swaps", () => {
    const oldSent = "The Facilitator adjusts the risk parameters (including the ALM strategy) each quarter.";
    const newSent = "The Custodian revises the funding parameters (including the ALM strategy) each cycle.";
    const result = refineSentencePair(oldSent, newSent);

    expect(result.fullSwap).toBe(false);
    expect(result.segs).toContainEqual(["=", "(including the ALM strategy)"]);
    expect(result.segs.some(([op, t]) => op === "-" && t.includes("risk parameters"))).toBe(true);
    expect(result.segs.some(([op, t]) => op === "+" && t.includes("funding parameters"))).toBe(true);
    expect(reconstruct(result.segs)).toEqual({ old: oldSent, new: newSent });
  });

  it("mixes an above-the-bar (whole-subclause swap) clause with a below-the-bar (word-level) clause around a shared middle clause", () => {
    const oldSent =
      "Alpha reports directly to the Bravo committee, following the standard review cycle, for the monthly allocation adjustment.";
    const newSent =
      "Zulu escalates immediately to the Yankee panel, following the standard review cycle, for the monthly allocation correction.";
    const result = refineSentencePair(oldSent, newSent);

    expect(result.fullSwap).toBe(false);
    // First subclause: heavily rewritten -> whole-subclause swap.
    expect(result.segs).toContainEqual(["-", "Alpha reports directly to the Bravo committee, "]);
    expect(result.segs).toContainEqual(["+", "Zulu escalates immediately to the Yankee panel, "]);
    // Middle subclause: identical -> stays plain text somewhere in an "=" segment.
    expect(result.segs.some(([op, t]) => op === "=" && t.includes("following the standard review cycle"))).toBe(
      true,
    );
    // Third subclause: single-word edit -> stays word-level, not a whole-subclause swap.
    expect(result.segs).toContainEqual(["-", "adjustment"]);
    expect(result.segs).toContainEqual(["+", "correction"]);
    expect(result.segs.some(([op, t]) => op === "-" && t.includes("for the monthly allocation"))).toBe(false);
    expect(reconstruct(result.segs)).toEqual({ old: oldSent, new: newSent });
  });
});
