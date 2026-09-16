import { describe, it, expect } from "vitest";
import {
  REPORT_GROUPS,
  REPORT_PROVENANCE,
  PROVENANCE_LABELS,
  PROVENANCE_TITLES,
  buildReportCatalog,
  catalogReportIds,
} from "./reportCatalog";
import { REPORT_TITLES, REPORT_DESCRIPTIONS } from "./routes";

describe("catalog completeness", () => {
  // The real failure this guards: adding a report to ReportId/routes.ts and
  // forgetting the index, so it ships unreachable from /reports.
  it("places every known report in exactly one group", () => {
    const ids = catalogReportIds();
    const known = Object.keys(REPORT_TITLES).sort();
    expect([...ids].sort()).toEqual(known);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("assigns a provenance to every grouped report", () => {
    for (const id of catalogReportIds()) expect(REPORT_PROVENANCE[id]).toBeTruthy();
  });

  it("gives every non-live provenance both a label and a tooltip", () => {
    for (const p of ["ai-assessed", "curated"] as const) {
      expect(PROVENANCE_LABELS[p]).toBeTruthy();
      expect(PROVENANCE_TITLES[p]).toBeTruthy();
    }
  });

  it("has a title and a hint on every group", () => {
    for (const g of REPORT_GROUPS) {
      expect(g.title).toBeTruthy();
      expect(g.hint).toBeTruthy();
      expect(g.reports.length).toBeGreaterThan(0);
    }
  });

  it("carries the shared title and description onto each card", () => {
    const card = buildReportCatalog("").flatMap((g) => g.cards).find((c) => c.id === "rewards");
    expect(card?.title).toBe(REPORT_TITLES.rewards);
    expect(card?.description).toBe(REPORT_DESCRIPTIONS.rewards);
  });
});

describe("buildReportCatalog", () => {
  it("returns every group and card for an empty query", () => {
    const groups = buildReportCatalog("");
    expect(groups).toHaveLength(REPORT_GROUPS.length);
    expect(groups.flatMap((g) => g.cards)).toHaveLength(catalogReportIds().length);
  });

  it("filters by title and drops emptied groups", () => {
    const groups = buildReportCatalog("reward");
    expect(groups.flatMap((g) => g.cards).map((c) => c.id)).toEqual(["rewards"]);
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe("On-chain & money");
  });

  it("filters by description text", () => {
    const ids = buildReportCatalog("multisig").flatMap((g) => g.cards).map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
  });

  it("filters by provenance label, so 'curated' finds the hand-maintained reports", () => {
    const ids = buildReportCatalog("curated").flatMap((g) => g.cards).map((c) => c.id);
    expect(ids).toContain("processes");
    // …and not the live ones.
    expect(ids).not.toContain("active-data");
  });

  // Potential Mistakes is an LLM sweep, not a hand-maintained inventory: its
  // findings are model judgement, which is what the badge has to warn about.
  it("finds the AI-assessed reports by their badge label", () => {
    const ids = buildReportCatalog("AI-assessed").flatMap((g) => g.cards).map((c) => c.id);
    expect([...ids].sort()).toEqual(["oea-assessment", "potential-mistakes", "risk-rules"]);
  });

  it("returns no groups when nothing matches", () => {
    expect(buildReportCatalog("zzz-nonexistent")).toEqual([]);
  });

  it("ignores surrounding whitespace and case", () => {
    expect(buildReportCatalog("  REWARD  ").flatMap((g) => g.cards).map((c) => c.id)).toEqual([
      "rewards",
    ]);
  });
});
