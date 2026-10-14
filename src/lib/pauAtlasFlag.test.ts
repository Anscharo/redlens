// A limit with no Atlas document is flagged by how it was set: always when a
// spell set it, only past two months when a cBEAM did, never when switched off
// or set another way.
import { describe, expect, it } from "vitest";
import { unmatchedFlag } from "./pauAtlasFlag.ts";

const NOW = Date.parse("2026-10-13T12:00:00Z");

describe("unmatchedFlag", () => {
  it("flags a spell-set limit however recent, naming the two possible causes, never an ordering", () => {
    for (const origin of ["spell", "relayed"] as const) {
      const f = unmatchedFlag(origin, "2026-10-12T14:00:00Z", false, NOW);
      expect(f?.kind).toBe("spell");
      expect(f?.text).toMatch(/did not connect it.*Atlas does not state it/);
      expect(f?.text).not.toMatch(/executed before/);
    }
  });
  it("flags a cBEAM-set limit only after more than two months", () => {
    expect(unmatchedFlag("operator", "2026-09-01T00:00:00Z", false, NOW)).toBeNull();
    expect(unmatchedFlag("operator", "2026-08-15T00:00:00Z", false, NOW)).toBeNull();
    const f = unmatchedFlag("operator", "2026-08-01T00:00:00Z", false, NOW);
    expect([f?.kind, f?.text]).toEqual(["cbeam", expect.stringContaining("may be behind, may not state this limit")]);
  });
  it("flags nothing for a switched-off limit, another origin, or an origin not known yet", () => {
    expect(unmatchedFlag("spell", "2026-10-12T00:00:00Z", true, NOW)).toBeNull();
    for (const origin of ["deployment", "direct", "unknown", null, undefined] as const) expect(unmatchedFlag(origin, "2026-01-01T00:00:00Z", false, NOW)).toBeNull();
  });
});
