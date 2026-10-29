// A limit with no Atlas document is flagged by how it was set: always when a
// spell set it, only past two months when a cBEAM did, never when switched off
// or set another way.
import { describe, expect, it } from "vitest";
import type { LiveRateLimit } from "./pau.ts";
import type { PauHistoryResponse } from "./pauHistory.ts";
import { limitFlag, unmatchedFlag } from "./pauAtlasFlag.ts";

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

  it("says a document names the constant, not that none was found, when one is shown beside the name", () => {
    const f = unmatchedFlag("spell", "2026-10-12T14:00:00Z", false, NOW, true);
    expect(f?.text).toMatch(/^No Atlas value is connected.*only names its controller constant/);
    expect(f?.text).not.toMatch(/No Atlas document found/);
  });
});

describe("limitFlag", () => {
  const entry = (tx: string, kind: string) => ({ chain: "ethereum", tx, block: 1, time: "t", primes: [], origin: { kind }, executive: null, changes: [] });
  const history = { entries: [entry("0xspell", "spell"), entry("0xold", "operator"), entry("0xdirect", "direct")] } as unknown as PauHistoryResponse;
  const limit = (tx: string, time: string, maxAmount = "1000000"): LiveRateLimit => ({
    key: "0x" + "a".repeat(64), configured: { maxAmount, slope: "0" }, setAt: { block: 1, time, tx }, changes: 1, data: null, available: null,
  });
  it("judges a limit by what its history says set it, worded for a named constant when asked", () => {
    expect(limitFlag(history, "ethereum", limit("0xspell", "2026-10-12T00:00:00Z"), NOW)?.kind).toBe("spell");
    expect(limitFlag(history, "ethereum", limit("0xold", "2026-07-01T00:00:00Z"), NOW)?.kind).toBe("cbeam");
    expect(limitFlag(history, "ethereum", limit("0xspell", "2026-10-12T00:00:00Z"), NOW, true)?.text).toMatch(/only names its controller constant/);
  });
  it("flags nothing while the history loads, for a switched-off limit, another origin, or a transaction on another chain", () => {
    expect(limitFlag(null, "ethereum", limit("0xspell", "2026-10-12T00:00:00Z"), NOW)).toBeNull();
    expect(limitFlag(history, "ethereum", limit("0xspell", "2026-10-12T00:00:00Z", "0"), NOW)).toBeNull();
    expect(limitFlag(history, "ethereum", limit("0xdirect", "2026-10-12T00:00:00Z"), NOW)).toBeNull();
    expect(limitFlag(history, "base", limit("0xspell", "2026-10-12T00:00:00Z"), NOW)).toBeNull();
  });
});
