// Which subpage renders a fragment a Prime's Info page does not.
import { describe, it, expect } from "vitest";
import type { RadarPrimitive } from "../../lib/actorIndex";
import { subpageForAnchor } from "./useSubpageAnchorForward";

const prims = [{ st: "distribution-reward", category: "Demand Side Stablecoin Primitives" }] as RadarPrimitive[];

describe("subpageForAnchor", () => {
  it("sends section anchors to their page without the fragment", () => {
    expect(subpageForAnchor("history", prims)).toEqual({ page: "history" });
    expect(subpageForAnchor("pau", prims)).toEqual({ page: "pau" });
    expect(subpageForAnchor("primitives", prims)).toEqual({ page: "primitives" });
  });

  it("keeps instance, invocation, primitive and category anchors on the instances page", () => {
    for (const id of ["instance-i1", "invocations", "invocations-distribution-reward", "distribution-reward", "distribution-reward-active", "demand-side-stablecoin-primitives"]) {
      expect(subpageForAnchor(id, prims)).toEqual({ page: "primitives", fragment: id });
    }
  });

  it("sends a PAUs page fragment there with the fragment kept", () => {
    for (const id of ["change-history", "rate-limits", "exec-vote-2026-04-09", "exec-vote-2026-04-09-2", `spell-0x${"ab".repeat(20)}`]) {
      expect(subpageForAnchor(id, prims)).toEqual({ page: "pau", fragment: id });
    }
  });

  it("leaves an anchor the Info page renders alone", () => {
    expect(subpageForAnchor("msc", prims)).toBeNull();
    expect(subpageForAnchor("relationships", prims)).toBeNull();
  });
});
