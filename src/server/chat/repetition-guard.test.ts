import { describe, it, expect } from "bun:test";
import { isRepetitionLoop } from "./repetition-guard.ts";

describe("isRepetitionLoop", () => {
  it("ignores short or normal prose", () => {
    expect(isRepetitionLoop("")).toBe(false);
    expect(isRepetitionLoop("a".repeat(40))).toBe(false);
    expect(
      isRepetitionLoop(
        "The Stability Scope covers risk parameters and capital rules for the Sky ecosystem. " +
          "See the Capital Ratio and related Active Data for the current figures.",
      ),
    ).toBe(false);
    // A word appearing twice is fine.
    expect(
      isRepetitionLoop(
        "Spark and Grove both instantiate the same template. Spark's rate limits live under Spark; " +
          "Grove's rate limits live under Grove. Do not confuse the two subtrees.",
      ),
    ).toBe(false);
  });

  it("flags a long run of the same character (aaaaaaaa…)", () => {
    expect(isRepetitionLoop("a".repeat(96))).toBe(true);
    expect(isRepetitionLoop("Preface: " + "A".repeat(100))).toBe(true);
  });

  it("flags spaced single-character loops (a a a a…)", () => {
    expect(isRepetitionLoop(("a ".repeat(60)).trim())).toBe(true);
  });

  it("flags the observed 'the same as' phrase loop", () => {
    const loop = "the same as ".repeat(12);
    expect(isRepetitionLoop("_SC11 same la la l'atlas. L'atlas is " + loop)).toBe(true);
  });

  it("flags 'same as the' and mixed suffix loops from the screenshots", () => {
    expect(isRepetitionLoop("same as the ".repeat(14))).toBe(true);
    const mixed = "the same as ".repeat(8) + "\n-------\n" + ("a ".repeat(40));
    expect(isRepetitionLoop(mixed)).toBe(true);
  });
});
