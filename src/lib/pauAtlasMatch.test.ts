// A key is marked as matching the atlas only when every stated value for it on
// that RateLimits contract is a certain match.
import { describe, expect, it } from "vitest";
import { atlasMatchedKeys, matchId } from "./pauAtlasMatch.ts";
import type { ValueCheck, ValueStatus } from "./pauAtlasValues.ts";

const check = (contract: string | null, key: string | null, status: ValueStatus): ValueCheck =>
  ({ contract, key, status, field: "maxAmount" }) as ValueCheck;

describe("atlasMatchedKeys", () => {
  it("marks a key whose values all match, per contract, case-insensitively", () => {
    const out = atlasMatchedKeys([check("0xAA", "0xK1", "match"), check("0xaa", "0xk1", "match"), check("0xBB", "0xK1", "match")]);
    expect([...out].sort()).toEqual([matchId("0xaa", "0xk1"), matchId("0xbb", "0xk1")]);
  });
  it("withholds the mark when any value is not a certain match", () => {
    for (const other of ["mismatch", "ambiguous", "units-unknown", "unread"] as const) {
      expect(atlasMatchedKeys([check("0xaa", "0xk1", "match"), check("0xaa", "0xk1", other)]).size).toBe(0);
    }
  });
  it("ignores checks with no contract or key", () => {
    expect(atlasMatchedKeys([check(null, "0xk1", "match"), check("0xaa", null, "match")]).size).toBe(0);
  });
});
