import { describe, expect, it } from "vitest";
import type { ReportId } from "../types";
import { REPORT_TITLES } from "./routes";
import { REPORT_INDEX_CARDS, REPORT_INDEX_SECTIONS, reportEmbedText, reportEmbedFields } from "./reportCatalog";

const ALL_IDS = Object.keys(REPORT_TITLES) as ReportId[];

describe("reportCatalog", () => {
  it("lists every REPORT_TITLES id exactly once", () => {
    const ids = REPORT_INDEX_CARDS.map((c) => c.id).sort();
    expect(ids).toEqual([...ALL_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stamps each card with its section title as category", () => {
    for (const section of REPORT_INDEX_SECTIONS) {
      expect(section.reports.length).toBeGreaterThan(0);
      for (const card of section.reports) {
        expect(card.category).toBe(section.title);
        expect(card.title).toBe(REPORT_TITLES[card.id]);
        expect(card.description.length).toBeGreaterThan(20);
      }
    }
  });

  it("embed text carries title, category, and description", () => {
    const card = REPORT_INDEX_CARDS[0]!;
    const text = reportEmbedText(card);
    expect(text).toContain(card.title);
    expect(text).toContain(card.category);
    expect(text).toContain(card.description);
    expect(reportEmbedFields(card)).toEqual([card.title, card.category, card.description, text]);
  });
});
