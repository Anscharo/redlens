// restoreAbsoluteLevels — port of upstream sync/partition.py. Bucket files in the
// consolidated layout open at `#` whatever their true depth; the composed level
// is re-derived from doc numbers. Without this every artifact root parsed as a
// depth-1 orphan (2026-09-10: 11 roots, 7,917 docs unreachable from A.6).
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { orderDocuments, restoreAbsoluteLevels, structuralDepth } from "../scripts/lib/atlas-source.mjs";
// @ts-expect-error — .mjs without types
import { parse } from "../scripts/lib/atlas-parser.mjs";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = (hashes: number, docNo: string, title: string, type: string, n: number) =>
  `${"#".repeat(hashes)} ${docNo} - ${title} [${type}]  <!-- UUID: ${U(n)} -->`;

// A scope bucket (absolute == relative for a scope) followed by an artifact
// bucket whose root is `#` in its own file.
const scopeFile = [
  h(1, "A.6", "The Agent Scope", "Scope", 1),
  "scope text",
  h(2, "A.6.1", "Agent Artifacts", "Article", 2),
  h(3, "A.6.1.1", "List Of Prime Agent Artifacts", "Section", 3),
  h(3, "A.6.1.2", "List Of Executor Agent Artifacts", "Section", 4),
].join("\n");
const sparkFile = [
  h(1, "A.6.1.1.1", "Spark", "Core", 10),
  "spark intro",
  h(2, "A.6.1.1.1.1", "Introduction", "Core", 11),
  h(2, "A.6.1.1.1.2", "Deep", "Core", 14),
  h(3, "A.6.1.1.1.2.1", "Deeper", "Core", 15),
  h(4, "A.6.1.1.1.2.1.1", "Deeper still", "Core", 16),
  h(5, "A.6.1.1.1.2.1.1.1", "Beyond the cap", "Core", 17),
  // phantom `0` extension segment: A.6.1.1.1.0 is claimed by no document. Compose
  // emits a parent's real children before any phantom-rooted subtree, so it comes last.
  h(3, "A.6.1.1.1.0.3.1", "Note", "Annotation", 12),
  h(1, "NR-7", "Needed", "Needed Research", 13),
].join("\n");
const joined = `${scopeFile}\n${sparkFile}`; // whole-file concatenation: what the loader used to do
const composed = orderDocuments(new Map([["A.6 - The-Agent-Scope.md", scopeFile.split("\n")], ["A.6.1.1.1 - Spark.md", sparkFile.split("\n")]])).join("\n");

describe("structuralDepth", () => {
  const real = new Set(["A.6", "A.6.1", "A.6.1.1", "A.6.1.1.1"]);
  it("counts only claimed ancestors — the leading A and 0-extensions are phantoms", () => {
    expect(structuralDepth("A.6", real)).toBe(0);
    expect(structuralDepth("A.6.1.1.1", real)).toBe(3);
    expect(structuralDepth("A.6.1.1.1.0.3.1", real)).toBe(4); // A.6.1.1.1.0 and .0.3 unclaimed
  });
});

describe("restoreAbsoluteLevels", () => {
  const out = restoreAbsoluteLevels(composed);
  const levels = Object.fromEntries(
    out.split("\n").filter((l: string) => /^#/.test(l)).map((l: string) => [l.split(" ")[1], l.match(/^#+/)![0].length]),
  );
  it("puts an artifact root at its parent's level + 1, not at #", () => {
    expect(levels["A.6.1.1"]).toBe(3);
    expect(levels["A.6.1.1.1"]).toBe(4);
    expect(levels["A.6.1.1.1.1"]).toBe(5);
  });
  it("does not count phantom 0-extension segments", () => {
    expect(levels["A.6.1.1.1.0.3.1"]).toBe(5); // annotation directly under Spark
  });
  it("gives Needed Research the preceding numbered document's level + 1", () => {
    expect(levels["NR-7"]).toBe(6);
  });
  it("caps at 6", () => {
    expect(levels["A.6.1.1.1.2.1.1"]).toBe(6);
    expect(levels["A.6.1.1.1.2.1.1.1"]).toBe(6);
  });
  it("changes heading lines only — content and contentHash are untouched", () => {
    // By id, not position: A.6.1.2 legitimately moves after the Prime subtree.
    const before = parse(joined);
    const after = parse(out);
    expect(after.nodes.length).toBe(before.nodes.length);
    for (const n of after.nodes as { id: string; content: string; contentHash: string }[]) {
      expect(n.contentHash).toBe(before.nodeMap[n.id].contentHash);
      expect(n.content).toBe(before.nodeMap[n.id].content);
    }
  });
  it("gives the artifact root its real parent after parsing (the bug this exists for)", () => {
    const after = parse(out);
    const spark = after.nodes.find((n: { doc_no: string }) => n.doc_no === "A.6.1.1.1");
    expect(spark.parentId).toBe(U(3)); // A.6.1.1 — not A.6.1.2, the last depth-3 heading in the A.6 file
    const before = parse(joined);
    expect(before.nodes.find((n: { doc_no: string }) => n.doc_no === "A.6.1.1.1").parentId).toBeNull();
  });
  it("orders documents, not buckets: A.6.1.2 is emitted after the Prime subtree", () => {
    const order = out.split("\n").filter((l: string) => /^#/.test(l)).map((l: string) => l.split(" ")[1]);
    expect(order.indexOf("A.6.1.2")).toBeGreaterThan(order.indexOf("A.6.1.1.1.2.1.1.1"));
    expect(order.indexOf("A.6.1.1.1")).toBe(order.indexOf("A.6.1.1") + 1);
  });
});
