import { describe, expect, it } from "vitest";
import { forumTopicUrlForMonth, monthsFromMscTitle } from "./forumMonths";

describe("monthsFromMscTitle", () => {
  it("reads a parenthetical month and year", () => {
    expect(monthsFromMscTitle("MSC #11 - Settlement Summary (July 2026)")).toEqual(["2026-07"]);
    expect(monthsFromMscTitle("MSC #8 — Settlement Summary (April 2026)")).toEqual(["2026-04"]);
  });

  it("reads a month after a comma or dash", () => {
    expect(monthsFromMscTitle("MSC #5 - Settlement Summary , January 2026 ( Spark and Grove)")).toEqual([
      "2026-01",
    ]);
    expect(monthsFromMscTitle("MSC #5 - January 2026")).toEqual(["2026-01"]);
  });

  it("expands a month range in the title", () => {
    expect(monthsFromMscTitle("Settlement Reconciliation - MSC #5–#10 (January–June 2026)")).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
    ]);
  });

  it("reads two months sharing a year", () => {
    expect(monthsFromMscTitle("MSC #4 - Settlement Summary (November & December 2025) - Obex")).toEqual([
      "2025-11", "2025-12",
    ]);
  });

  it("returns nothing when the title names no month", () => {
    expect(monthsFromMscTitle("Technical scope of the Monthly Settlement Cycle")).toEqual([]);
  });
});

describe("forumTopicUrlForMonth", () => {
  const topics = [
    { title: "Settlement Reconciliation - MSC #5–#10 (January–June 2026)", url: "/recon", postedAt: "2026-07-01" },
    { title: "MSC #10 - Settlement Summary (June 2026)", url: "/june", postedAt: "2026-06-20" },
    { title: "MSC #5 - January 2026", url: "/jan-short", postedAt: "2026-02-01" },
    { title: "MSC #5 - Settlement Summary , January 2026 ( Spark and Grove)", url: "/jan-sum", postedAt: "2026-02-02" },
  ];

  it("picks the single-month summary over a covering reconciliation", () => {
    expect(forumTopicUrlForMonth(topics, "2026-06")).toBe("/june");
  });

  it("prefers a Summary title when two threads name the same month", () => {
    expect(forumTopicUrlForMonth(topics, "2026-01")).toBe("/jan-sum");
  });

  it("uses a stored period column when present", () => {
    expect(
      forumTopicUrlForMonth(
        [{ title: "unrelated", url: "/stored", period: ["2026-07"] }],
        "2026-07",
      ),
    ).toBe("/stored");
  });

  it("returns nothing when no title names that month", () => {
    expect(forumTopicUrlForMonth(topics, "2026-07")).toBeUndefined();
  });
});
