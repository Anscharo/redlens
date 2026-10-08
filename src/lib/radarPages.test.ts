import { describe, it, expect } from "vitest";
import { ACTOR_PAGES, actorPageDef, hasActorPages, isActorPageKey } from "./radarPages";

describe("radarPages", () => {
  it("lists each subpage once, in nav order", () => {
    expect(ACTOR_PAGES.map((p) => p.key)).toEqual(["settlements", "history", "instances", "pau"]);
    expect(actorPageDef("pau").title).toBe("Parallelized Allocation Units");
  });

  it("recognises only registered segments", () => {
    expect(isActorPageKey("history")).toBe(true);
    expect(isActorPageKey("info")).toBe(false);
    expect(isActorPageKey(undefined)).toBe(false);
  });

  it("gives subpages to Prime Agents only", () => {
    expect(hasActorPages({ et: "agent", st: "prime" })).toBe(true);
    expect(hasActorPages({ et: "agent", st: "core_executor" })).toBe(false);
    expect(hasActorPages({ et: "facilitator_org", st: null })).toBe(false);
  });
});
