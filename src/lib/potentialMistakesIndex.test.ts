import { describe, it, expect } from "vitest";
import {
  resolveMistakes,
  sortMistakes,
  mistakesToCSV,
  mistakeSearchFields,
  presentCategories,
  countBy,
  type Mistake,
  type MistakeRow,
  type MistakesFile,
} from "./potentialMistakesIndex";
import type { AtlasNode } from "../types";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_GONE = "33333333-3333-4333-8333-333333333333";

const mistake = (over: Partial<Mistake> = {}): Mistake => ({
  id: "A.1.1#typo",
  docNo: "A.1.1",
  uuid: UUID_A,
  file: "A.1 - The-Governance-Scope.md",
  category: "typo",
  severity: "high",
  pass: "language",
  quote: "Sky Ecoystem",
  issue: "Misspelling of 'Ecosystem'.",
  fix: "Sky Ecosystem",
  ...over,
});

const doc = (id: string, doc_no: string, title: string): AtlasNode =>
  ({ id, doc_no, title, type: "Core", depth: 3, parentId: null, content: "", order: 0, addressRefs: [] }) as AtlasNode;

const file = (findings: Mistake[]): MistakesFile => ({
  generatedAt: "2026-09-15",
  atlasSha: "d64eca48",
  documentsScanned: 11529,
  note: "",
  passes: { language: "", factual: "", deterministic: "" },
  findings,
});

const DOCS: Record<string, AtlasNode> = {
  [UUID_A]: doc(UUID_A, "A.1.1", "Governance"),
  [UUID_B]: doc(UUID_B, "A.2.9", "Support"), // moved from A.2.8
};

describe("resolveMistakes", () => {
  it("marks a finding current when the doc_no still matches", () => {
    const [row] = resolveMistakes(file([mistake()]), DOCS);
    expect(row.status).toBe("current");
    expect(row.currentDocNo).toBe("A.1.1");
    expect(row.title).toBe("Governance");
  });

  it("marks a finding renumbered when the doc moved since the sweep", () => {
    const [row] = resolveMistakes(file([mistake({ uuid: UUID_B, docNo: "A.2.8" })]), DOCS);
    expect(row.status).toBe("renumbered");
    expect(row.currentDocNo).toBe("A.2.9");
  });

  it("marks a finding missing when its UUID is gone from the atlas", () => {
    const [row] = resolveMistakes(file([mistake({ uuid: UUID_GONE })]), DOCS);
    expect(row.status).toBe("missing");
    expect(row.currentDocNo).toBe("");
  });

  it("marks a UUID-less finding as corpus-wide rather than missing", () => {
    const [row] = resolveMistakes(file([mistake({ uuid: null })]), DOCS);
    expect(row.status).toBe("corpus");
  });
});

describe("sortMistakes", () => {
  it("orders by severity, then doc_no numerically", () => {
    const rows = [
      { ...mistake({ id: "c", docNo: "A.10.1", severity: "medium" }), status: "current", currentDocNo: "", title: "" },
      { ...mistake({ id: "b", docNo: "A.2.1", severity: "high" }), status: "current", currentDocNo: "", title: "" },
      { ...mistake({ id: "a", docNo: "A.10.1", severity: "high" }), status: "current", currentDocNo: "", title: "" },
    ] as MistakeRow[];
    expect(sortMistakes(rows).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts A.10 after A.2 (numeric, not lexicographic)", () => {
    const rows = [
      { ...mistake({ id: "ten", docNo: "A.10.1" }), status: "current", currentDocNo: "", title: "" },
      { ...mistake({ id: "two", docNo: "A.2.1" }), status: "current", currentDocNo: "", title: "" },
    ] as MistakeRow[];
    expect(sortMistakes(rows).map((r) => r.id)).toEqual(["two", "ten"]);
  });
});

describe("mistakesToCSV", () => {
  it("emits a UUID and an absolute Atlas Link per row", () => {
    const rows = resolveMistakes(file([mistake()]), DOCS);
    const csv = mistakesToCSV(rows);
    expect(csv.split("\r\n")[0]).toContain('"UUID","Atlas Link"');
    expect(csv).toContain(UUID_A);
    expect(csv).toContain(`/atlas?id=${UUID_A}`);
  });

  it("leaves UUID and Atlas Link empty for a corpus-wide finding", () => {
    const rows = resolveMistakes(file([mistake({ uuid: null })]), DOCS);
    const line = mistakesToCSV(rows).split("\r\n")[1];
    expect(line.endsWith('"",""')).toBe(true);
  });

  it("escapes quotes and commas in the quoted atlas text", () => {
    const rows = resolveMistakes(file([mistake({ quote: 'a "quoted", comma' })]), DOCS);
    expect(mistakesToCSV(rows)).toContain('"a ""quoted"", comma"');
  });

  it("emits exactly one row per finding", () => {
    const rows = resolveMistakes(file([mistake({ id: "a" }), mistake({ id: "b", uuid: UUID_B })]), DOCS);
    expect(mistakesToCSV(rows).split("\r\n")).toHaveLength(3); // header + 2
  });
});

describe("mistakeSearchFields", () => {
  it("matches on the recorded doc_no, the quote and the category label", () => {
    const [row] = resolveMistakes(file([mistake()]), DOCS);
    const values = mistakeSearchFields(row).map((f) => f.value);
    expect(values).toContain("A.1.1");
    expect(values).toContain("Sky Ecoystem");
    expect(values).toContain("Typo / spelling");
  });
});

describe("presentCategories / countBy", () => {
  it("returns only categories present, in display order", () => {
    const rows = resolveMistakes(
      file([mistake({ category: "grammar" }), mistake({ id: "x", category: "numeric" })]),
      DOCS,
    );
    expect(presentCategories(rows)).toEqual(["numeric", "grammar"]);
  });

  it("counts rows per key", () => {
    const rows = resolveMistakes(
      file([mistake(), mistake({ id: "x", severity: "medium" }), mistake({ id: "y" })]),
      DOCS,
    );
    expect(countBy(rows, (r) => r.severity)).toEqual({ high: 2, medium: 1 });
  });
});
