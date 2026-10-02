import { describe, expect, it } from "vitest";
import { REPORT_INDEX_GROUPS } from "./reportCatalog";
import {
  cosineSim,
  filterReportGroups,
  groupsForIds,
  hitsFromScores,
  normalizeReportIndexQuery,
  SEMANTIC_MAX,
  SEMANTIC_MIN,
} from "./reportIndexSearch";

const idsOf = (query: string, extraIds?: Set<string>) =>
  filterReportGroups(REPORT_INDEX_GROUPS, query, extraIds).flatMap((g) => g.cards.map((c) => c.id));

describe("normalizeReportIndexQuery", () => {
  it("trims, lowercases, and unwraps mode quotes", () => {
    expect(normalizeReportIndexQuery("  Reward ")).toBe("reward");
    expect(normalizeReportIndexQuery('"stale dates"')).toBe("stale dates");
    expect(normalizeReportIndexQuery("'OEA'")).toBe("oea");
    expect(normalizeReportIndexQuery("   ")).toBe("");
    expect(normalizeReportIndexQuery('""')).toBe("");
  });
});

describe("filterReportGroups — lexical", () => {
  it("returns the same group array identity for a blank query", () => {
    expect(filterReportGroups(REPORT_INDEX_GROUPS, "")).toBe(REPORT_INDEX_GROUPS);
    expect(filterReportGroups(REPORT_INDEX_GROUPS, "   ")).toBe(REPORT_INDEX_GROUPS);
    expect(filterReportGroups(REPORT_INDEX_GROUPS, '""')).toBe(REPORT_INDEX_GROUPS);
  });

  it("matches a report name substring", () => {
    expect(idsOf("reward")).toEqual(["rewards"]);
    expect(idsOf("Integrator Reward")).toEqual(["rewards"]);
  });

  it("matches hyphen-insensitive title tokens (on-chain / on chain)", () => {
    expect(idsOf("on chain")).toContain("onchain-addresses");
  });

  it("matches a plural of a word that only appears singular in the copy", () => {
    expect(idsOf("multisigs")).toContain("onchain-addresses");
  });

  it("description copy can surface a report whose title does not contain the query", () => {
    // GovOps' description names Active Data as a duty; the title does not.
    expect(idsOf("Active Data")).toEqual(["gov-ops-responsibilities", "active-data"]);
  });

  it("keeps every report in a group whose title matches", () => {
    const health = filterReportGroups(REPORT_INDEX_GROUPS, "atlas health");
    expect(health).toHaveLength(1);
    expect(health[0]!.title).toBe("Atlas health");
    expect(health[0]!.cards.map((c) => c.id)).toEqual([
      "potential-mistakes",
      "stale-dates",
      "mod-frequency",
    ]);
    // Same array identity as the catalog group — not a filtered copy.
    expect(health[0]).toBe(REPORT_INDEX_GROUPS.find((g) => g.title === "Atlas health"));

    const roles = filterReportGroups(REPORT_INDEX_GROUPS, "roles & duties");
    expect(roles).toHaveLength(1);
    expect(roles[0]!.title).toBe("Roles & duties");
    expect(roles[0]!.cards).toHaveLength(3);
    expect(roles[0]).toBe(REPORT_INDEX_GROUPS[0]);
  });

  it("keeps every report in a group whose hint matches", () => {
    const ids = idsOf("obliges");
    expect(ids).toEqual(["of-responsibilities", "gov-ops-responsibilities", "oea-assessment"]);
  });

  it("matches description copy that is not in the title", () => {
    // "CSV export" is in the Active Data / On-Chain Addresses descriptions,
    // not in any title.
    const ids = idsOf("csv export");
    expect(ids).toContain("active-data");
    expect(ids).toContain("onchain-addresses");
    expect(ids).not.toContain("rewards");
  });

  it("filters by provenance label, so 'curated' finds the hand-maintained reports", () => {
    expect(idsOf("curated")).toEqual(["processes"]);
  });

  // Potential Mistakes is an LLM sweep, not a hand-maintained inventory: its
  // findings are model judgement, which is what the badge has to warn about.
  it("finds the AI-assessed reports by their badge label", () => {
    expect([...idsOf("AI-assessed")].sort()).toEqual([
      "oea-assessment",
      "potential-mistakes",
      "risk-rules",
    ]);
  });

  it("drops empty groups and matches nothing for noise", () => {
    expect(filterReportGroups(REPORT_INDEX_GROUPS, "zzz-nonexistent")).toEqual([]);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(idsOf("  REWARD  ")).toEqual(["rewards"]);
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

  it("keeps only the highest-scoring extras when more than SEMANTIC_MAX clear the floor", () => {
    expect(
      hitsFromScores(
        new Map([
          ["a", 0.9],
          ["b", 0.8],
          ["c", 0.7],
          ["d", 0.6],
        ]),
      ),
    ).toEqual(new Set(["a", "b", "c"]));
    expect(SEMANTIC_MAX).toBe(3);
  });
});

describe("groupsForIds", () => {
  it("narrows catalog groups to the given card ids", () => {
    const groups = groupsForIds(REPORT_INDEX_GROUPS, new Set(["stale-dates", "rewards"]));
    expect(groups.map((g) => g.title)).toEqual(["On-chain & money", "Atlas health"]);
    expect(groups.flatMap((g) => g.cards.map((c) => c.id))).toEqual(["rewards", "stale-dates"]);
  });

  it("returns nothing for an empty id set", () => {
    expect(groupsForIds(REPORT_INDEX_GROUPS, new Set())).toEqual([]);
  });
});

describe("filterReportGroups — semantic ids", () => {
  it("includes a report that only the extra-id lane matches", () => {
    expect(idsOf("wallet addresses", new Set(["stale-dates"]))).toEqual(["stale-dates"]);
  });

  it("keeps a lexical name match even when extra ids omit it", () => {
    expect(idsOf("reward", new Set())).toEqual(["rewards"]);
  });
});
