import { describe, it, expect } from "vitest";
import type { AtlasNode } from "../types";
import type { ModCount, ModTimelineRow } from "./history";
import {
  buildModCountHistogram,
  buildModFrequencyRows,
  buildModTimelineBuckets,
  groupModFrequencyRows,
  matchesFrequency,
  modFrequencyRowsToCSV,
  modFrequencySearchFields,
  modFrequencySummaryToCSV,
  sectionOf,
  summarizeModFrequencyMatches,
} from "./modFrequencyIndex";

function node(id: string, doc_no: string, title: string, type = "Section"): AtlasNode {
  return { id, doc_no, title, type, depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
}

function count(docId: string, n: number, lastModified: string | null = null): ModCount {
  return { docId, count: n, lastModified, contentCount: n };
}

const DOCS: Record<string, AtlasNode> = {
  root: node("root", "A", "The Atlas", "Scope"),
  scope2: node("scope2", "A.2", "Accessibility Scope", "Scope"),
  deep: node("deep", "A.2.1.4.2", "Deep Article", "Article"),
  scope0: node("scope0", "A.0", "Governing Principles", "Scope"),
  nr: node("nr", "NR-3", "Open Question", "Needed Research"),
};

describe("sectionOf", () => {
  it("takes the two-segment prefix of a deep doc_no", () => {
    expect(sectionOf("A.2.1.4.2")).toBe("A.2");
  });
  it("keeps a scope's own doc_no", () => {
    expect(sectionOf("A.2")).toBe("A.2");
  });
  it("keeps the root doc_no", () => {
    expect(sectionOf("A")).toBe("A");
  });
  it("collapses NR-X docs to the NR family", () => {
    expect(sectionOf("NR-3")).toBe("NR");
  });
});

describe("buildModFrequencyRows", () => {
  it("zero-fills docs without a count row and drops orphan count rows", () => {
    const rows = buildModFrequencyRows(DOCS, [
      count("deep", 2, "2026-01-05"),
      count("gone-doc", 9, "2026-01-01"), // no longer in the atlas
    ]);
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.id === "deep")?.count).toBe(2);
    expect(rows.find((r) => r.id === "scope2")?.count).toBe(0);
    expect(rows.find((r) => r.id === "scope2")?.lastModified).toBeNull();
    expect(rows.some((r) => r.id === "gone-doc")).toBe(false);
  });

  it("resolves sectionTitle from the scope node, falling back to the section doc_no", () => {
    const rows = buildModFrequencyRows(DOCS, []);
    expect(rows.find((r) => r.id === "deep")?.sectionTitle).toBe("Accessibility Scope");
    expect(rows.find((r) => r.id === "nr")?.sectionTitle).toBe("NR");
  });

  it("stamps each row's agent from the given map, defaulting to null when omitted", () => {
    const withoutAgent = buildModFrequencyRows(DOCS, []);
    expect(withoutAgent.every((r) => r.agent === null)).toBe(true);

    const withAgent = buildModFrequencyRows(DOCS, [], new Map([["deep", "Spark"]]));
    expect(withAgent.find((r) => r.id === "deep")?.agent).toBe("Spark");
    expect(withAgent.find((r) => r.id === "scope2")?.agent).toBeNull();
  });

  it("sorts by count asc, then never-modified first, then oldest edit, then doc_no numeric", () => {
    const docs: Record<string, AtlasNode> = {
      a10: node("a10", "A.10", "Ten"),
      a2: node("a2", "A.2", "Two"),
      old: node("old", "A.3", "Old edit"),
      recent: node("recent", "A.4", "Recent edit"),
      busy: node("busy", "A.5", "Busy"),
    };
    const rows = buildModFrequencyRows(docs, [
      count("old", 1, "2024-01-01"),
      count("recent", 1, "2026-06-01"),
      count("busy", 7, "2026-06-01"),
    ]);
    // a2 before a10: numeric doc_no compare within the zero-count tie.
    expect(rows.map((r) => r.id)).toEqual(["a2", "a10", "old", "recent", "busy"]);
  });
});

describe("groupModFrequencyRows", () => {
  const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);

  it("groups by section with scope-titled labels, ordered by doc_no", () => {
    const groups = groupModFrequencyRows(rows, "section");
    expect(groups.map((g) => g.key)).toEqual(["A", "A.0", "A.2", "NR"]);
    expect(groups.find((g) => g.key === "A.2")?.label).toBe("A.2 — Accessibility Scope");
    expect(groups.find((g) => g.key === "NR")?.label).toBe("NR");
    expect(groups.find((g) => g.key === "A.2")?.rows.map((r) => r.id)).toEqual(["scope2", "deep"]);
  });

  it("groups by type alphabetically", () => {
    const groups = groupModFrequencyRows(rows, "type");
    expect(groups.map((g) => g.key)).toEqual(["Article", "Needed Research", "Scope"]);
  });

  it("sub-splits a section into per-agent groups when rows carry an agent, keeping the agent-less remainder in the plain section bucket", () => {
    const agentDocs: Record<string, AtlasNode> = {
      agentScope: node("agentScope", "A.6", "The Agent Scope", "Scope"),
      sparkRoot: node("sparkRoot", "A.6.1.1.1", "Spark", "Core"),
      sparkChild: node("sparkChild", "A.6.1.1.1.2", "Spark ICD", "Section"),
      groveChild: node("groveChild", "A.6.1.1.2.5", "Grove ICD", "Section"),
    };
    const agentByDoc = new Map([
      ["sparkChild", "Spark"],
      ["groveChild", "Grove"],
    ]);
    const agentRows = buildModFrequencyRows(agentDocs, [], agentByDoc);
    const groups = groupModFrequencyRows(agentRows, "section");
    expect(groups.map((g) => g.key)).toEqual(["A.6", "A.6:Grove", "A.6:Spark"]);
    expect(groups.find((g) => g.key === "A.6")?.rows.map((r) => r.id)).toEqual(["agentScope", "sparkRoot"]);
    expect(groups.find((g) => g.key === "A.6:Spark")?.label).toBe("A.6 — Spark");
    expect(groups.find((g) => g.key === "A.6:Spark")?.rows.map((r) => r.id)).toEqual(["sparkChild"]);
    expect(groups.find((g) => g.key === "A.6:Grove")?.rows.map((r) => r.id)).toEqual(["groveChild"]);
  });

  it("doesn't sub-split by agent when grouping by type", () => {
    const agentDocs: Record<string, AtlasNode> = {
      sparkChild: node("sparkChild", "A.6.1.1.1.2", "Spark ICD", "Section"),
      groveChild: node("groveChild", "A.6.1.1.2.5", "Grove ICD", "Section"),
    };
    const agentByDoc = new Map([
      ["sparkChild", "Spark"],
      ["groveChild", "Grove"],
    ]);
    const agentRows = buildModFrequencyRows(agentDocs, [], agentByDoc);
    const groups = groupModFrequencyRows(agentRows, "type");
    expect(groups.map((g) => g.key)).toEqual(["Section"]);
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe("summarizeModFrequencyMatches", () => {
  const zeroOnly = (r: { count: number }) => r.count === 0;

  it("counts matching docs per category against the category's full total", () => {
    // scope0 (0), root (0), scope2 (0), nr (0) are all zero-fills (no count row);
    // only "deep" (A.2) was actually modified.
    const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);
    const summary = summarizeModFrequencyMatches(rows, "section", zeroOnly);
    expect(summary.find((s) => s.key === "A")).toEqual({
      key: "A", label: "A — The Atlas", total: 1, matchCount: 1, matchPercent: 100,
    });
    expect(summary.find((s) => s.key === "A.2")).toEqual({
      key: "A.2",
      label: "A.2 — Accessibility Scope",
      total: 2, // scope2 + deep
      matchCount: 1, // scope2 only — deep has 2 edits
      matchPercent: 50,
    });
  });

  it("reflects whatever predicate is passed, not just zero-modification", () => {
    const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);
    const summary = summarizeModFrequencyMatches(rows, "section", (r) => r.count > 0);
    expect(summary.find((s) => s.key === "A.2")).toEqual({
      key: "A.2",
      label: "A.2 — Accessibility Scope",
      total: 2,
      matchCount: 1, // deep only — scope2 has 0 edits
      matchPercent: 50,
    });
    expect(summary.find((s) => s.key === "A")).toEqual({
      key: "A", label: "A — The Atlas", total: 1, matchCount: 0, matchPercent: 0,
    });
  });

  it("returns no categories for an empty row set", () => {
    const summary = summarizeModFrequencyMatches([], "type", zeroOnly);
    expect(summary).toEqual([]);
  });

  it("groups by type using the same category buckets as groupModFrequencyRows", () => {
    const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);
    const summary = summarizeModFrequencyMatches(rows, "type", zeroOnly);
    expect(summary.map((s) => s.key)).toEqual(["Article", "Needed Research", "Scope"]);
    expect(summary.find((s) => s.key === "Article")).toEqual({
      key: "Article", label: "Article", total: 1, matchCount: 0, matchPercent: 0,
    });
    expect(summary.find((s) => s.key === "Scope")).toEqual({
      key: "Scope", label: "Scope", total: 3, matchCount: 3, matchPercent: 100,
    });
  });
});

describe("buildModCountHistogram", () => {
  it("returns one bucket per distinct count, zero-filling gaps", () => {
    const rows = buildModFrequencyRows(DOCS, [count("deep", 3, "2026-01-05")]);
    // 4 zero-count docs (root, scope2, scope0, nr) + deep at count 3.
    const buckets = buildModCountHistogram(rows);
    expect(buckets).toEqual([
      { count: 0, label: "0", docs: 4, isTail: false },
      { count: 1, label: "1", docs: 0, isTail: false },
      { count: 2, label: "2", docs: 0, isTail: false },
      { count: 3, label: "3", docs: 1, isTail: false },
    ]);
  });

  it("collapses counts past the cap into one tail bucket", () => {
    const docs: Record<string, AtlasNode> = { hot: node("hot", "A.9", "Hot doc") };
    const rows = buildModFrequencyRows(docs, [count("hot", 47, "2026-01-05")]);
    const buckets = buildModCountHistogram(rows);
    expect(buckets.at(-1)).toEqual({ count: 20, label: "20+", docs: 1, isTail: true });
    expect(buckets).toHaveLength(21);
  });

  it("returns no buckets for an empty row set", () => {
    expect(buildModCountHistogram([])).toEqual([]);
  });
});

function timelineRow(month: string, n: number): ModTimelineRow {
  return { month, count: n };
}

describe("buildModTimelineBuckets", () => {
  it("zero-fills every month between the earliest and latest edit", () => {
    const buckets = buildModTimelineBuckets([timelineRow("2026-01", 5), timelineRow("2026-04", 2)]);
    expect(buckets).toEqual([
      { month: "2026-01", label: "Jan '26", count: 5 },
      { month: "2026-02", label: "Feb '26", count: 0 },
      { month: "2026-03", label: "Mar '26", count: 0 },
      { month: "2026-04", label: "Apr '26", count: 2 },
    ]);
  });

  it("spans a year boundary", () => {
    const buckets = buildModTimelineBuckets([timelineRow("2025-11", 1), timelineRow("2026-02", 3)]);
    expect(buckets.map((b) => b.month)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(buckets.map((b) => b.label)).toEqual(["Nov '25", "Dec '25", "Jan '26", "Feb '26"]);
  });

  it("handles unsorted input and a single month", () => {
    const buckets = buildModTimelineBuckets([timelineRow("2026-03", 7)]);
    expect(buckets).toEqual([{ month: "2026-03", label: "Mar '26", count: 7 }]);
  });

  it("returns no buckets for an empty row set", () => {
    expect(buildModTimelineBuckets([])).toEqual([]);
  });
});

describe("matchesFrequency", () => {
  it("lte keeps count <= threshold", () => {
    expect(matchesFrequency(1, "lte", 1)).toBe(true);
    expect(matchesFrequency(0, "lte", 1)).toBe(true);
    expect(matchesFrequency(2, "lte", 1)).toBe(false);
  });

  it("gt keeps count > threshold", () => {
    expect(matchesFrequency(2, "gt", 1)).toBe(true);
    expect(matchesFrequency(1, "gt", 1)).toBe(false);
  });
});

describe("modFrequencySearchFields", () => {
  it("covers doc no, title, type, and section", () => {
    const rows = buildModFrequencyRows(DOCS, []);
    const fields = modFrequencySearchFields(rows.find((r) => r.id === "deep")!);
    expect(fields.map((f) => f.value)).toEqual([
      "A.2.1.4.2",
      "Deep Article",
      "Article",
      "A.2 Accessibility Scope",
    ]);
  });
});

describe("modFrequencyRowsToCSV", () => {
  it("emits one row per doc with UUID + Atlas Link and 'never' for unmodified", () => {
    const rows = buildModFrequencyRows(
      { deep: DOCS.deep, scope2: DOCS.scope2 },
      [count("deep", 2, "2026-01-05")],
    );
    const csv = modFrequencyRowsToCSV(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(
      '"Doc No","Title","Type","Section","Section Title","Semantic Edits","Last Modified","UUID","Atlas Link"',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"never"');
    expect(lines[1]).toContain('"scope2"');
    expect(lines[2]).toContain('"2026-01-05"');
    expect(lines[2]).toContain("/atlas?id=deep");
  });
});

describe("modFrequencySummaryToCSV", () => {
  it("emits one row per category with total, match count, and percent", () => {
    const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);
    const summary = summarizeModFrequencyMatches(rows, "section", (r) => r.count === 0);
    const csv = modFrequencySummaryToCSV(summary);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe('"Category","Total Documents","Matching Documents","% Matching"');
    expect(lines).toContain('"A.2 — Accessibility Scope","2","1","50.0%"');
  });

  it("emits only the header for an empty summary", () => {
    expect(modFrequencySummaryToCSV([]).split("\r\n")).toEqual([
      '"Category","Total Documents","Matching Documents","% Matching"',
    ]);
  });
});
