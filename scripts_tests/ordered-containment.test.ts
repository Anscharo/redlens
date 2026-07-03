// Ordered, typo-tolerant word containment (prototype A, plan §10.4) — the independent
// third corroborator ported from the UUID-swap detector. Verifies order-sensitivity,
// typo tolerance, the boilerplate-sibling margin, and candidate ranking.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { orderedWordContainment, sameDocScore, wordEq, bestByContainment, findContainer } from "../scripts/htmlhist/ordered-containment.mjs";

describe("orderedWordContainment", () => {
  it("is 1 when all of a's words appear in order in b (b may add text)", () => {
    expect(orderedWordContainment("alpha beta gamma delta", "alpha beta gamma delta epsilon zeta")).toBe(1);
  });
  it("drops below 1 when order is broken", () => {
    expect(orderedWordContainment("alpha beta gamma delta", "delta gamma beta alpha")).toBeLessThan(1);
  });
  it("is ~0 for unrelated text", () => {
    expect(orderedWordContainment("alpha beta gamma delta", "nothing here resembles those tokens")).toBeLessThanOrEqual(0.25);
  });
  it("ignores bodies shorter than MIN_WORDS", () => {
    expect(orderedWordContainment("one two three", "one two three four")).toBe(0);
  });
});

describe("wordEq (typo tolerance)", () => {
  it("matches a single-char typo in a longer word but not a short one", () => {
    expect(wordEq("governance", "govrnance")).toBe(true); // 10 chars → tol 2
    expect(wordEq("dao", "dai")).toBe(false); // 3 chars → exact only
  });
});

describe("sameDocScore + bestByContainment", () => {
  it("is symmetric-ish: an expanded edit of the same doc scores high", () => {
    const older = "the operational executor agent settles rewards each epoch";
    const newer = "the operational executor agent settles rewards each epoch in usdc now"; // edited/expanded
    expect(sameDocScore(older, newer)).toBeGreaterThan(0.9);
  });
  it("picks the distinctive predecessor and reports a margin over a sibling", () => {
    const subject = "the reward conduit forwards payments to the integrator every block reliably";
    const cands = [
      { key: "match", content: "the reward conduit forwards payments to the integrator every block" },
      { key: "sibling", content: "the penalty conduit reverses payments from the integrator each block" },
    ];
    const { best, bestScore, margin } = bestByContainment(subject, cands);
    expect(best.key).toBe("match");
    expect(bestScore).toBeGreaterThan(0.8);
    expect(margin).toBeGreaterThan(0.05); // distinguishable from the near-identical sibling
  });
});

describe("findContainer (split/merge lineage)", () => {
  const child = "rewards are settled to each integrator every epoch in usdc";
  it("finds the unique larger parent that contains the child's prose in order", () => {
    const pool = [
      { id: "parent", content: `the operational executor manages many duties and ${child} and also reports to governance each quarter` },
      { id: "unrelated", content: "penalties accrue when validators miss their attestation windows repeatedly over time" },
    ];
    expect(findContainer(child, pool)?.id).toBe("parent");
  });
  it("declines a near-equal match (a rename/move, not an extraction)", () => {
    expect(findContainer(child, [{ id: "same", content: child + " now" }])).toBeNull(); // not ≥1.3× larger
  });
  it("declines when the content sits in more than one container (ambiguous)", () => {
    const wrap = (s: string) => `preamble text goes here ${s} and a trailing clause to pad the body out nicely`;
    expect(findContainer(child, [{ id: "a", content: wrap(child) }, { id: "b", content: wrap(child) }])).toBeNull();
  });
});
