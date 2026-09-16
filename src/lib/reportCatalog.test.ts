import { describe, it, expect } from "vitest";
import {
  REPORT_GROUPS,
  REPORT_PROVENANCE,
  PROVENANCE_LABELS,
  PROVENANCE_TITLES,
  REPORT_INDEX_CARDS,
  REPORT_INDEX_GROUPS,
  buildReportCatalog,
  catalogReportIds,
  reportEmbedText,
  reportEmbedFields,
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
    const card = buildReportCatalog().flatMap((g) => g.cards).find((c) => c.id === "rewards");
    expect(card?.title).toBe(REPORT_TITLES.rewards);
    expect(card?.description).toBe(REPORT_DESCRIPTIONS.rewards);
  });

  it("stamps each card with its group title as category", () => {
    for (const group of REPORT_INDEX_GROUPS) {
      expect(group.cards.length).toBeGreaterThan(0);
      for (const card of group.cards) {
        expect(card.category).toBe(group.title);
        expect(card.hint).toBe(group.hint);
        expect(card.title).toBe(REPORT_TITLES[card.id]);
        expect(card.description.length).toBeGreaterThan(20);
      }
    }
  });
});

describe("buildReportCatalog", () => {
  it("returns every group and card, unfiltered", () => {
    const groups = buildReportCatalog();
    expect(groups).toHaveLength(REPORT_GROUPS.length);
    expect(groups.flatMap((g) => g.cards)).toHaveLength(catalogReportIds().length);
    expect(REPORT_INDEX_GROUPS).toHaveLength(REPORT_GROUPS.length);
    expect(REPORT_INDEX_CARDS).toHaveLength(catalogReportIds().length);
  });
});

describe("report embed fields", () => {
  it("embed text carries title, category, hint, and description", () => {
    const card = REPORT_INDEX_CARDS[0]!;
    const text = reportEmbedText(card);
    expect(text).toContain(card.title);
    expect(text).toContain(card.category);
    expect(text).toContain(card.hint);
    expect(text).toContain(card.description);
    expect(reportEmbedFields(card)).toEqual([
      card.title,
      card.category,
      card.hint,
      card.description,
      text,
    ]);
  });

  it("includes the provenance badge label for non-live cards", () => {
    const card = REPORT_INDEX_CARDS.find((c) => c.id === "processes")!;
    expect(reportEmbedText(card)).toContain("curated");
    expect(reportEmbedFields(card)).toContain("curated");
  });
});
