// Which subpage renders a fragment a Prime's Info page does not.
import { describe, it, expect } from "vitest";
import type { RadarPrimitive } from "../../lib/actorIndex";
import { subpageForAnchor } from "./useSubpageAnchorForward";

const prims = [{ st: "distribution-reward", category: "Demand Side Stablecoin Primitives" }] as RadarPrimitive[];

describe("subpageForAnchor", () => {
  it("sends section anchors to their page without the fragment", () => {
    expect(subpageForAnchor("history", prims)).toEqual({ page: "history" });
    expect(subpageForAnchor("pau", prims)).toEqual({ page: "pau" });
    expect(subpageForAnchor("primitives", prims)).toEqual({ page: "instances" });
  });

  it("keeps instance, invocation, primitive and category anchors on the instances page", () => {
    for (const id of ["instance-i1", "invocations", "invocations-distribution-reward", "distribution-reward", "distribution-reward-active", "demand-side-stablecoin-primitives"]) {
      expect(subpageForAnchor(id, prims)).toEqual({ page: "instances", fragment: id });
    }
  });

  it("leaves an anchor the Info page renders alone", () => {
    expect(subpageForAnchor("msc", prims)).toBeNull();
    expect(subpageForAnchor("relationships", prims)).toBeNull();
  });
});
