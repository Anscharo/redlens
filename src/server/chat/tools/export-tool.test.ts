// Unit tests for the chat-only export artifact builder. Pure — no indexes, no
// network. Run under `bun test`.
import { test, expect } from "bun:test";
import { buildExportArtifact, EXPORT_TOOL_NAME } from "./export-tool.ts";

test("markdown export: prepends the title as an H1 and uses a .md extension", () => {
  const art = buildExportArtifact({ format: "markdown", title: "My Findings", markdown: "Body text.", filename: "notes" });
  expect(art.format).toBe("markdown");
  expect(art.filename).toBe("notes.md");
  expect(art.mime).toBe("text/markdown;charset=utf-8");
  expect(art.content).toBe("# My Findings\n\nBody text.");
  expect(art.bytes).toBe(art.content.length);
});

test("markdown export: falls back to a slugged title when no filename is given", () => {
  const art = buildExportArtifact({ format: "markdown", title: "GovOps Duties!", markdown: "x" });
  expect(art.filename).toBe("GovOps-Duties.md");
});

test("markdown export: empty body is rejected", () => {
  expect(() => buildExportArtifact({ format: "markdown", markdown: "   " })).toThrow(/requires a non-empty/);
  expect(() => buildExportArtifact({ format: "markdown" })).toThrow(/requires a non-empty/);
});

test("csv export: builds RFC-4180 output via toCSV and uses a .csv extension", () => {
  const art = buildExportArtifact({
    format: "csv",
    filename: "table",
    columns: ["Doc", "Type"],
    rows: [
      ["A.1", "Scope"],
      ["A.2, extra", "Core"],
    ],
  });
  expect(art.filename).toBe("table.csv");
  expect(art.mime).toBe("text/csv;charset=utf-8");
  // Header + quoted cells, CRLF-joined; the comma-bearing cell stays one field.
  expect(art.content).toBe('"Doc","Type"\r\n"A.1","Scope"\r\n"A.2, extra","Core"');
});

test("csv export: a formula-leading cell is neutralized (injection guard from toCSV)", () => {
  const art = buildExportArtifact({ format: "csv", columns: ["x"], rows: [["=SUM(A1)"]] });
  expect(art.content).toContain("'=SUM(A1)");
});

test("csv export: missing columns/rows are rejected with a model-readable message", () => {
  expect(() => buildExportArtifact({ format: "csv", rows: [["a"]] })).toThrow(/requires a non-empty `columns`/);
  expect(() => buildExportArtifact({ format: "csv", columns: ["a"] })).toThrow(/requires a `rows`/);
});

test("filename sanitization strips path separators", () => {
  const art = buildExportArtifact({ format: "markdown", filename: "../../etc/passwd", markdown: "x" });
  expect(art.filename).not.toContain("/");
  expect(art.filename).not.toContain("..");
  expect(art.filename.endsWith(".md")).toBe(true);
});

test("tool name is the chat-only export identifier", () => {
  expect(EXPORT_TOOL_NAME).toBe("export_findings");
});
