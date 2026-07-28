import { describe, it, expect } from "vitest";
import { extractHeadings, countHeadings, partitionHeadings } from "./libraryHeadings";

describe("extractHeadings", () => {
  it("extracts h2/h3 ATX headings in source order with slugs", () => {
    const raw = ["# Title", "", "## Part I — Concept catalog", "", "### Instruments 1 · Ecosystem Accords", "text"].join(
      "\n",
    );
    const headings = extractHeadings(raw);
    expect(headings).toEqual([
      { level: 2, text: "Part I — Concept catalog", slug: "part-i-concept-catalog" },
      { level: 3, text: "Instruments 1 · Ecosystem Accords", slug: "instruments-1-ecosystem-accords" },
    ]);
  });

  it("ignores h1 and h4+ headings", () => {
    const raw = ["# H1", "## H2", "#### H4", "##### H5"].join("\n");
    const headings = extractHeadings(raw);
    expect(headings).toEqual([{ level: 2, text: "H2", slug: "h2" }]);
  });

  it("strips inline emphasis/code markup from the heading text", () => {
    const raw = "## The `foo` and **bar** and *baz*";
    const headings = extractHeadings(raw);
    expect(headings[0].text).toBe("The foo and bar and baz");
  });

  it("dedupes repeated heading text with -1/-2 suffixes, in document order", () => {
    const raw = ["## Duplicate", "### Duplicate", "## Duplicate"].join("\n");
    const headings = extractHeadings(raw);
    expect(headings.map((h) => h.slug)).toEqual(["duplicate", "duplicate-1", "duplicate-2"]);
  });

  it("skips a trailing heading line whose text is whitespace-only after trimming", () => {
    const raw = ["## Real Heading", "##   "].join("\n");
    const headings = extractHeadings(raw);
    expect(headings).toEqual([{ level: 2, text: "Real Heading", slug: "real-heading" }]);
  });
});

describe("countHeadings", () => {
  it("counts only h2/h3 ATX heading lines", () => {
    expect(countHeadings(["# H1", "## H2a", "### H3a", "#### H4", "## H2b"].join("\n"))).toBe(3);
  });

  it("returns 0 for text with no headings (e.g. a ConceptCensus segment's md remainder)", () => {
    expect(countHeadings("just prose, no headings here")).toBe(0);
  });
});

describe("partitionHeadings", () => {
  it("slices a flat heading list into per-segment chunks matching each segment's own heading count", () => {
    const raw = ["## A", "text", "### B", "## C"].join("\n");
    const headings = extractHeadings(raw); // [A, B, C]
    const segmentTexts = ["## A\ntext\n### B", "## C"]; // as if split around a :::census marker
    const chunks = partitionHeadings(headings, segmentTexts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].map((h) => h.slug)).toEqual(["a", "b"]);
    expect(chunks[1].map((h) => h.slug)).toEqual(["c"]);
  });

  it("gives a segment with no headings an empty chunk", () => {
    const headings = extractHeadings("## Only");
    const chunks = partitionHeadings(headings, ["census placeholder text", "## Only"]);
    expect(chunks[0]).toEqual([]);
    expect(chunks[1].map((h) => h.slug)).toEqual(["only"]);
  });
});
