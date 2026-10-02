// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { describe, it, expect } from "bun:test";
import { bodyWhollyReplaced, bodyWordsKept, lineOverlap, orderedWordContainment } from "./identity.ts";
import { OZONE_OLD, OZONE_MOVED, OZONE_MOVED_TYPO, OZONE_SUBST, SKY_PRIMITIVES } from "./identity-fixtures.ts";

describe("text measures", () => {
  it("lineOverlap: identical=1, disjoint≈0, empty handling", () => {
    expect(lineOverlap("a\nb", "a\nb")).toBe(1);
    expect(lineOverlap(OZONE_OLD, SKY_PRIMITIVES)).toBeLessThanOrEqual(0.15);
    expect(lineOverlap("", "")).toBe(1);
    expect(lineOverlap("a", "")).toBe(0);
  });

  it("orderedWordContainment: full=1, expanded=1, typo≈1, real substitution<0.95, unrelated low", () => {
    expect(orderedWordContainment(OZONE_OLD, OZONE_OLD)).toBe(1);
    expect(orderedWordContainment(OZONE_OLD, OZONE_MOVED)).toBe(1); // expanded
    expect(orderedWordContainment(OZONE_OLD, OZONE_MOVED_TYPO)).toBeGreaterThanOrEqual(0.95); // typo tolerated
    expect(orderedWordContainment(OZONE_OLD, OZONE_SUBST)).toBeLessThan(0.95); // real word changed
    expect(orderedWordContainment(OZONE_OLD, SKY_PRIMITIVES)).toBeLessThan(0.5);
    expect(orderedWordContainment("one two three", "one two three four")).toBe(0); // below RELOCATION_MIN_WORDS
  });

  it("lineOverlap is BINARY on a one-line body — why it never decides alone", () => {
    // Not a wish, a fact about the measure: the LCS runs over two 1-element
    // arrays, so a single changed word and a wholesale replacement both score
    // 0. 83% of the live atlas is one line, which is why bodyWhollyReplaced
    // requires the word measure to agree before it calls a body replaced.
    const one = "The ALMProxy for Keel is whitelisted on the LitePSM contract today.";
    expect(lineOverlap(one, one.replace("ALMProxy", "ALM Proxy"))).toBe(0); // one word
    expect(lineOverlap(one, SKY_PRIMITIVES)).toBe(0); // a different document
  });

  it("bodyWordsKept: compares a large body in full, where orderedWordContainment gives up", () => {
    // Over ~632 words a side orderedWordContainment answers 0 for any change
    // at all. Right for a relocation link, wrong for the body test.
    const big = Array.from({ length: 250 }, (_, i) => `- entry${i} holds value${i}`).join("\n");
    const edited = big.replace("entry125 holds", "entry125 now holds").replace(/^- /gm, "* ");
    expect(orderedWordContainment(big, edited)).toBe(0);
    expect(bodyWordsKept(big, edited)).toBe(1);
    expect(bodyWhollyReplaced(big, edited)).toBe(false);
    expect(bodyWordsKept("", "anything")).toBeNull();
  });
});
