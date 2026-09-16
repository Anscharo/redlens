import { describe, expect, it } from "vitest";
import { REPORT_INDEX_SECTIONS } from "./reportCatalog";
import { cosineSim, filterReportSections, hitsFromScores, normalizeReportIndexQuery, SEMANTIC_MIN } from "./reportIndexSearch";

const idsOf = (query: string, extraIds?: Set<string>) =>
  filterReportSections(REPORT_INDEX_SECTIONS, query, extraIds).flatMap((s) => s.reports.map((r) => r.id));

describe("normalizeReportIndexQuery", () => {
  it("trims, lowercases, and unwraps mode quotes", () => {
    expect(normalizeReportIndexQuery("  Reward ")).toBe("reward");
    expect(normalizeReportIndexQuery('"stale dates"')).toBe("stale dates");
    expect(normalizeReportIndexQuery("'OEA'")).toBe("oea");
    expect(normalizeReportIndexQuery("   ")).toBe("");
    expect(normalizeReportIndexQuery('""')).toBe("");
  });
});

describe("filterReportSections — lexical", () => {
  it("returns the same section array identity for a blank query", () => {
    expect(filterReportSections(REPORT_INDEX_SECTIONS, "")).toBe(REPORT_INDEX_SECTIONS);
    expect(filterReportSections(REPORT_INDEX_SECTIONS, "   ")).toBe(REPORT_INDEX_SECTIONS);
    expect(filterReportSections(REPORT_INDEX_SECTIONS, '""')).toBe(REPORT_INDEX_SECTIONS);
  });

  it("matches a report name substring", () => {
    expect(idsOf("reward")).toEqual(["rewards"]);
    expect(idsOf("Integrator Reward")).toEqual(["rewards"]);
  });

  it("matches hyphen-insensitive title tokens (on-chain / on chain)", () => {
    expect(idsOf("on chain")).toContain("onchain-addresses");
  });

  it("description copy can surface a report whose title does not contain the query", () => {
    // GovOps' description names Active Data as a duty; the title does not.
    expect(idsOf("Active Data")).toEqual(["gov-ops-responsibilities", "active-data"]);
  });

  it("keeps every report in a section whose category matches", () => {
    const oea = filterReportSections(REPORT_INDEX_SECTIONS, "oea reports");
    expect(oea).toHaveLength(1);
    expect(oea[0]!.title).toBe("OEA Reports");
    expect(oea[0]!.reports.map((r) => r.id)).toEqual([
      "of-responsibilities",
      "gov-ops-responsibilities",
      "oea-assessment",
    ]);
    // Same array identity as the catalog section — not a filtered copy.
    expect(oea[0]).toBe(REPORT_INDEX_SECTIONS[0]);

    const general = filterReportSections(REPORT_INDEX_SECTIONS, "general");
    expect(general).toHaveLength(1);
    expect(general[0]!.title).toBe("General Reports");
    expect(general[0]!.reports).toHaveLength(8);
    expect(general[0]).toBe(REPORT_INDEX_SECTIONS[1]);
  });

  it("matches description copy that is not in the title", () => {
    // "CSV export" is in the Active Data / On-Chain Addresses descriptions,
    // not in any title.
    const ids = idsOf("csv export");
    expect(ids).toContain("active-data");
    expect(ids).toContain("onchain-addresses");
    expect(ids).not.toContain("rewards");
  });

  it("drops empty sections and matches nothing for noise", () => {
    expect(filterReportSections(REPORT_INDEX_SECTIONS, "zzz-nonexistent")).toEqual([]);
  });
});

describe("cosineSim", () => {
  it("is a dot product of equal-length vectors", () => {
    expect(cosineSim(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBe(1);
    expect(cosineSim(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBe(0);
    expect(cosineSim(new Float32Array([0.6, 0.8]), new Float32Array([0.6, 0.8]))).toBeCloseTo(1);
  });

  it("throws on a length mismatch", () => {
    expect(() => cosineSim(new Float32Array([1]), new Float32Array([1, 0]))).toThrow(/length mismatch/);
  });
});

describe("hitsFromScores", () => {
  it("keeps ids at or above the floor", () => {
    expect(
      hitsFromScores(new Map([["stale-dates", SEMANTIC_MIN], ["rewards", 0.1]])),
    ).toEqual(new Set(["stale-dates"]));
    expect(hitsFromScores(new Map([["stale-dates", SEMANTIC_MIN - 0.01]])).size).toBe(0);
  });
});

describe("filterReportSections — semantic ids", () => {
  it("includes a report that only the extra-id lane matches", () => {
    expect(idsOf("wallet addresses", new Set(["stale-dates"]))).toEqual(["stale-dates"]);
  });

  it("keeps a lexical name match even when extra ids omit it", () => {
    expect(idsOf("reward", new Set())).toEqual(["rewards"]);
  });
});
