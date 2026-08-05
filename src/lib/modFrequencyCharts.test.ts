import { describe, it, expect } from "vitest";
import type { AtlasNode } from "../types";
import type { ModCount, ModTimelinePeriodRow, ModTimelineCommitRow } from "./history";
import { buildModFrequencyRows } from "./modFrequencyIndex";
import {
  buildModCountHistogram,
  buildModTimelineMonthBuckets,
  buildModTimelineWeekBuckets,
  buildModTimelineCommitBuckets,
} from "./modFrequencyCharts";

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

function periodRow(period: string, n: number): ModTimelinePeriodRow {
  return { period, count: n };
}

function commitRow(seq: number, sha: string, date: string | null, n: number): ModTimelineCommitRow {
  return { seq, sha, date, count: n };
}

describe("buildModTimelineMonthBuckets", () => {
  it("zero-fills every month between the earliest and latest edit", () => {
    const buckets = buildModTimelineMonthBuckets([periodRow("2026-01", 5), periodRow("2026-04", 2)]);
    expect(buckets).toEqual([
      { key: "2026-01", label: "Jan '26", count: 5 },
      { key: "2026-02", label: "Feb '26", count: 0 },
      { key: "2026-03", label: "Mar '26", count: 0 },
      { key: "2026-04", label: "Apr '26", count: 2 },
    ]);
  });

  it("spans a year boundary", () => {
    const buckets = buildModTimelineMonthBuckets([periodRow("2025-11", 1), periodRow("2026-02", 3)]);
    expect(buckets.map((b) => b.key)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(buckets.map((b) => b.label)).toEqual(["Nov '25", "Dec '25", "Jan '26", "Feb '26"]);
  });

  it("handles unsorted input and a single month", () => {
    const buckets = buildModTimelineMonthBuckets([periodRow("2026-03", 7)]);
    expect(buckets).toEqual([{ key: "2026-03", label: "Mar '26", count: 7 }]);
  });

  it("returns no buckets for an empty row set", () => {
    expect(buildModTimelineMonthBuckets([])).toEqual([]);
  });
});

describe("buildModTimelineWeekBuckets", () => {
  it("zero-fills every week between the earliest and latest edit", () => {
    // 2026-01-05 and 2026-01-19 are both Mondays, 2 weeks apart.
    const buckets = buildModTimelineWeekBuckets([periodRow("2026-01-05", 4), periodRow("2026-01-19", 1)]);
    expect(buckets).toEqual([
      { key: "2026-01-05", label: "Jan 5 '26", count: 4 },
      { key: "2026-01-12", label: "Jan 12 '26", count: 0 },
      { key: "2026-01-19", label: "Jan 19 '26", count: 1 },
    ]);
  });

  it("returns no buckets for an empty row set", () => {
    expect(buildModTimelineWeekBuckets([])).toEqual([]);
  });
});

describe("buildModTimelineCommitBuckets", () => {
  it("maps one bucket per commit, in the given order, with no zero-fill", () => {
    const buckets = buildModTimelineCommitBuckets([
      commitRow(10, "abc1234def5", "2026-01-05", 2),
      commitRow(11, "mip:104:14.3", null, 1),
    ]);
    expect(buckets).toEqual([
      { key: "10", label: "2026-01-05", count: 2 },
      { key: "11", label: "mip:104:14", count: 1 }, // no date: falls back to a truncated sha
    ]);
  });

  it("returns no buckets for an empty row set", () => {
    expect(buildModTimelineCommitBuckets([])).toEqual([]);
  });
});
