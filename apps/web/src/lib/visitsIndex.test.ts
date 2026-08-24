import { describe, it, expect } from "vitest";
import { buildHistoryView, describeFilters } from "./visitsIndex";
import { atlasOf, DOCS, visit } from "./visitsIndex.fixture";
import type { VisitEvent } from "./visitHistory";

const ATLAS = atlasOf(DOCS);

describe("describeFilters", () => {
  it("decodes params into friendly chips", () => {
    expect(describeFilters("cat=spark&q=usds")).toEqual([
      ["category", "spark"],
      ["search", "usds"],
    ]);
  });

  it("falls back to the raw key for a filter it doesn't know", () => {
    expect(describeFilters("brandnew=1")).toEqual([["brandnew", "1"]]);
  });

  it("renames the radar MSC month param", () => {
    expect(describeFilters("msc=2026-07")).toEqual([["cycle", "2026-07"]]);
  });

  it("hides params that select what you were looking at rather than filter it", () => {
    // The atlas reader puts the focused doc in ?id= — a raw UUID reads as a
    // nonsense chip, but it stays in the stored path so the link still restores it.
    expect(describeFilters("id=4a08ca6c-e652-49e4-9b79-4831b20e600a&hide=multisig")).toEqual([
      ["hidden", "multisig"],
    ]);
    expect(describeFilters("filters=1")).toEqual([]);
  });

  it("is empty for no params", () => {
    expect(describeFilters("")).toEqual([]);
  });
});

describe("buildHistoryView", () => {
  const events: VisitEvent[] = [
    visit("/atlas?id=a311", "Deep governance doc", 100),
    visit("/atlas?id=a311", "Deep governance doc", 500),
    visit("/atlas?id=a311", "Deep governance doc", 600),
    visit("/atlas?id=a312", "Another governance doc", 200),
    visit("/atlas?id=a321", "A different branch", 300),
    visit("/atlas?id=ag1", "Spark artifact leaf", 400),
    visit("/atlas?id=ag1", "Spark artifact leaf", 450),
    visit("/atlas?id=ag3", "A different agent", 460),
    visit("/reports/rewards", "Integrator Reward Relationships", 700, "cat=spark"),
    visit("/radar/spark", "Spark", 800),
    visit("/preview/9/atlas?id=a311", "Deep governance doc", 900),
  ];

  it("orders recent documents by last visit and most-viewed by count", () => {
    const v = buildHistoryView(events, ATLAS);
    expect(v.recentDocs[0].id).toBe("a311"); // last at 600
    expect(v.recentDocs.map((d) => d.id)).toEqual(["a311", "ag3", "ag1", "a321", "a312"]);
    expect(v.topDocs[0]).toMatchObject({ id: "a311", count: 3, docNo: "A.3.1.1" });
    expect(v.topDocs[1]).toMatchObject({ id: "ag1", count: 2 });
  });

  it("excludes preview visits from every card", () => {
    const v = buildHistoryView(events, ATLAS);
    expect(v.recentDocs.every((d) => !d.path.startsWith("/preview"))).toBe(true);
    // The preview visit of a311 would have made it the most recent, at 900.
    expect(v.topDocs.find((d) => d.id === "a311")?.count).toBe(3);
  });

  it("keeps the most recent reports and radar pages with their filters", () => {
    const v = buildHistoryView(events, ATLAS);
    expect(v.recentPages.map((p) => p.label)).toEqual(["Spark", "Integrator Reward Relationships"]);
    const rewards = v.recentPages[1];
    expect(rewards.href).toBe("/reports/rewards?cat=spark");
    expect(rewards.filters).toEqual([["category", "spark"]]);
  });

  it("counts a report once however its filters were set", () => {
    const v = buildHistoryView(
      [
        visit("/reports/rewards", "Integrator Reward Relationships", 10, "cat=a"),
        visit("/reports/rewards", "Integrator Reward Relationships", 20, "cat=b"),
        visit("/reports/rewards", "Integrator Reward Relationships", 30),
      ],
      ATLAS,
    );
    expect(v.recentPages).toHaveLength(1);
    expect(v.recentPages[0].count).toBe(3);
    expect(v.recentPages[0].href).toBe("/reports/rewards"); // the latest visit had none
  });

  it("still lists a document the atlas no longer has, minus its tree", () => {
    const v = buildHistoryView([visit("/atlas?id=gone", "Retired doc", 10)], ATLAS);
    expect(v.topDocs[0]).toMatchObject({ id: "gone", label: "Retired doc", docNo: null });
    expect(v.topTrees).toEqual([]);
  });

  it("renders from the log alone when the atlas hasn't loaded", () => {
    const v = buildHistoryView(events, null);
    expect(v.topDocs[0]).toMatchObject({ id: "a311", label: "Deep governance doc", docNo: null });
    expect(v.topTrees).toEqual([]);
    expect(v.recentPages).toHaveLength(2);
  });

  it("treats a log of only searches as empty — no card renders them", () => {
    // useSearchTracking logs searches; the page shows none, so they must not
    // turn "No history yet" into four "Nothing here yet" cards.
    const v = buildHistoryView([visit("/?q=facilitator", "facilitator", 10)], ATLAS);
    expect(v.empty).toBe(true);
    expect(v.recentDocs).toEqual([]);
    expect(v.recentPages).toEqual([]);
  });

  it("reports an empty log", () => {
    expect(buildHistoryView([], ATLAS).empty).toBe(true);
    expect(buildHistoryView(events, ATLAS).empty).toBe(false);
  });
});
