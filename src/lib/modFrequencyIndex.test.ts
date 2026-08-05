import { describe, it, expect } from "vitest";
import type { AtlasNode } from "../types";
import type { ModCount } from "./history";
import {
  buildModFrequencyRows,
  groupModFrequencyRows,
  modFrequencyRowsToCSV,
  modFrequencySearchFields,
  sectionOf,
  summarizeZeroModFrequency,
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
});

describe("summarizeZeroModFrequency", () => {
  it("counts zero-modification docs per category against the category's full total", () => {
    // scope0 (0), root (0), scope2 (0), nr (0) are all zero-fills (no count row);
    // only "deep" (A.2) was actually modified.
    const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);
    const summary = summarizeZeroModFrequency(rows, "section");
    expect(summary.find((s) => s.key === "A")).toEqual({
      key: "A", label: "A — The Atlas", total: 1, zeroCount: 1, zeroPercent: 100,
    });
    expect(summary.find((s) => s.key === "A.2")).toEqual({
      key: "A.2",
      label: "A.2 — Accessibility Scope",
      total: 2, // scope2 + deep
      zeroCount: 1, // scope2 only — deep has 2 edits
      zeroPercent: 50,
    });
  });

  it("returns no categories for an empty row set", () => {
    const summary = summarizeZeroModFrequency([], "type");
    expect(summary).toEqual([]);
  });

  it("groups by type using the same category buckets as groupModFrequencyRows", () => {
    const rows = buildModFrequencyRows(DOCS, [count("deep", 2, "2026-01-05")]);
    const summary = summarizeZeroModFrequency(rows, "type");
    expect(summary.map((s) => s.key)).toEqual(["Article", "Needed Research", "Scope"]);
    expect(summary.find((s) => s.key === "Article")).toEqual({
      key: "Article", label: "Article", total: 1, zeroCount: 0, zeroPercent: 0,
    });
    expect(summary.find((s) => s.key === "Scope")).toEqual({
      key: "Scope", label: "Scope", total: 3, zeroCount: 3, zeroPercent: 100,
    });
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
