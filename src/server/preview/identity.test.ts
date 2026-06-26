// Run via `bun test src/server`. Pure unit tests — no DB, no network.
import { describe, it, expect } from "bun:test";
import { detectIdentitySwaps, lineOverlap, wordContainment, type SwapNode } from "./identity.ts";

function mapOf(nodes: SwapNode[]): Map<string, SwapNode> {
  return new Map(nodes.map((n) => [n.id, n]));
}

// The real fork case (Redline-Group:ozone-executor-agent-artifact): UUID
// a491d7d0 kept its doc number but was repurposed from "Operational GovOps"
// (Ozone) to "Sky Primitives", and the old GovOps content moved (expanded) to a
// brand-new UUID 384d29b0.
const OZONE_OLD = "Operational GovOps for Operational Executor Agent Ozone is Soter Labs.";
const SKY_PRIMITIVES = "The documents herein implement the Sky Primitives for Ozone See [A.2.2 - Sky Primitives](https://sky-atlas.io/#fcde2604).";
const OZONE_MOVED =
  "Operational GovOps for Operational Executor Agent Ozone is Soter Labs. Soter Labs plays a crucial role in implementing Prime Agent strategies, doing so by executing the technical specifications outlined in Primitive Configuration Documents of Agent Artifacts.";

describe("detectIdentitySwaps", () => {
  it("flags a repurposed UUID and links to where the old content moved", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.6.1.2.2.2", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "a491", doc_no: "A.6.1.2.2.2", title: "Sky Primitives", content: SKY_PRIMITIVES },
      { id: "384d", doc_no: "A.6.1.2.2.2.1.1.3.1.1.5.2", title: "Soter Labs -", content: OZONE_MOVED },
    ]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({
      changed: ["a491"],
      added: ["384d"],
      mainById: main,
      previewById: preview,
    });
    expect(identitySwap.a491).toMatchObject({
      oldTitle: "Operational GovOps",
      newTitle: "Sky Primitives",
      movedTo: { id: "384d", doc_no: "A.6.1.2.2.2.1.1.3.1.1.5.2" },
    });
    expect(formerUuid["384d"]).toMatchObject({ previousId: "a491", previousTitle: "Operational GovOps" });
  });

  it("records a swap with no movedTo when the old content was deleted, not moved", () => {
    const main = mapOf([{ id: "a491", doc_no: "A.6.1.2.2.2", title: "Operational GovOps", content: OZONE_OLD }]);
    const preview = mapOf([{ id: "a491", doc_no: "A.6.1.2.2.2", title: "Sky Primitives", content: SKY_PRIMITIVES }]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["a491"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.a491.movedTo).toBeUndefined();
    expect(Object.keys(formerUuid)).toHaveLength(0);
  });

  it("does NOT flag an ordinary edit (same title, body mostly preserved)", () => {
    const main = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: "The reward rate is 5%.\nReviewed quarterly." }]);
    const preview = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: "The reward rate is 7%.\nReviewed quarterly." }]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.x).toBeUndefined();
  });

  it("does NOT flag a specialization where the new title extends the old (no relocated content)", () => {
    // Real fork case: "Operational Executor Agent" → "Operational Executor Agent
    // Ozone" with a rewritten body, but the old content didn't move anywhere.
    const main = mapOf([{ id: "x", doc_no: "A.6.1.2.2", title: "Operational Executor Agent", content: "Generic agent template.\nFill in per instance." }]);
    const preview = mapOf([{ id: "x", doc_no: "A.6.1.2.2", title: "Operational Executor Agent Ozone", content: "Ozone is the operational executor agent.\nManaged by Soter Labs." }]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.x).toBeUndefined();
  });

  it("DOES flag a specialization-looking retitle when the old content demonstrably relocated", () => {
    const main = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Module", content: OZONE_OLD }]);
    const preview = mapOf([
      { id: "x", doc_no: "A.1", title: "Reward Module v2", content: SKY_PRIMITIVES },
      { id: "z", doc_no: "A.9", title: "Archive", content: OZONE_MOVED },
    ]);
    const { identitySwap, formerUuid } = detectIdentitySwaps({ changed: ["x"], added: ["z"], mainById: main, previewById: preview });
    expect(identitySwap.x?.movedTo?.id).toBe("z");
    expect(formerUuid.z?.previousId).toBe("x");
  });

  it("does NOT flag a retitle that keeps the same body (rename, not swap)", () => {
    const body = "The reward rate is 5%.\nReviewed quarterly.";
    const main = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate", content: body }]);
    const preview = mapOf([{ id: "x", doc_no: "A.1", title: "Reward Rate (legacy)", content: body }]);
    const { identitySwap } = detectIdentitySwaps({ changed: ["x"], added: [], mainById: main, previewById: preview });
    expect(identitySwap.x).toBeUndefined();
  });
});

describe("similarity helpers", () => {
  it("lineOverlap: identical=1, disjoint=0", () => {
    expect(lineOverlap("a\nb", "a\nb")).toBe(1);
    expect(lineOverlap(OZONE_OLD, SKY_PRIMITIVES)).toBeLessThanOrEqual(0.15);
    expect(lineOverlap("", "")).toBe(1);
    expect(lineOverlap("a", "")).toBe(0);
  });

  it("wordContainment survives expansion of the moved content", () => {
    expect(wordContainment(OZONE_OLD, OZONE_MOVED)).toBeGreaterThanOrEqual(0.7);
    expect(wordContainment("a is b", "totally unrelated")).toBe(0); // too few words
  });
});
