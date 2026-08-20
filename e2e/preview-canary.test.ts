import { describe, expect, it } from "vitest";
import { changedDocIds, CONTENT_FILE_RE, rawUrl, splitByUuid } from "./preview-canary";

const SCOPE = [
  "# A.1 - The Governance Scope [Scope]  <!-- UUID: 18ac7dd3-c646-4352-9b0d-d01a2932d7d1 -->",
  "Preamble text.",
  "## A.1.1 - Spirit of the Atlas [Article]  <!-- UUID: 86A93DAB-2f12-4c3f-9285-bcc4520c851b -->",
  "Article body line one.",
  "Article body line two.",
].join("\n");

describe("splitByUuid", () => {
  it("splits a consolidated file into heading-inclusive per-doc sections, lowercasing ids", () => {
    const docs = splitByUuid(SCOPE);
    expect([...docs.keys()]).toEqual([
      "18ac7dd3-c646-4352-9b0d-d01a2932d7d1",
      "86a93dab-2f12-4c3f-9285-bcc4520c851b",
    ]);
    expect(docs.get("18ac7dd3-c646-4352-9b0d-d01a2932d7d1")).toContain("# A.1 - The Governance Scope");
    expect(docs.get("18ac7dd3-c646-4352-9b0d-d01a2932d7d1")).toContain("Preamble text.");
    expect(docs.get("86a93dab-2f12-4c3f-9285-bcc4520c851b")).toContain("Article body line two.");
  });

  it("ignores prose before the first UUID heading and headings without a UUID marker", () => {
    const docs = splitByUuid("intro\n## Plain Heading\n" + SCOPE);
    expect(docs.size).toBe(2);
  });
});

describe("changedDocIds", () => {
  const base = splitByUuid(SCOPE);

  it("flags edited sections and added sections, not untouched or deleted ones", () => {
    const head = splitByUuid(
      SCOPE.replace("Article body line two.", "Article body line two, amended.") +
        "\n### A.1.1.1 - New Section [Section]  <!-- UUID: 9524005e-e135-4ba5-aff3-d846923f3874 -->\nNew.",
    );
    expect(changedDocIds(base, head).sort()).toEqual([
      "86a93dab-2f12-4c3f-9285-bcc4520c851b",
      "9524005e-e135-4ba5-aff3-d846923f3874",
    ]);
    // Deleted docs are absent from head and never expected.
    expect(changedDocIds(base, new Map())).toEqual([]);
  });

  it("flags a renumber-only edit because the heading line is part of the section", () => {
    const head = splitByUuid(SCOPE.replace("## A.1.1 -", "## A.1.2 -"));
    expect(changedDocIds(base, head)).toEqual(["86a93dab-2f12-4c3f-9285-bcc4520c851b"]);
  });

  it("does not flag a doc moved between files when the union text is identical", () => {
    // The union maps already merge every changed file per side, so a clean
    // move produces identical base and head entries.
    expect(changedDocIds(base, splitByUuid(SCOPE))).toEqual([]);
  });
});

describe("candidate file filter", () => {
  it("matches consolidated content files only", () => {
    expect(CONTENT_FILE_RE.test("content/A.2 - The-Support-Scope.md")).toBe(true);
    expect(CONTENT_FILE_RE.test("content/nested/document.md")).toBe(false);
    expect(CONTENT_FILE_RE.test("ATLAS_MARKDOWN_SYNTAX.md")).toBe(false);
    expect(CONTENT_FILE_RE.test("sync/atlas_source.py")).toBe(false);
  });
});

describe("rawUrl", () => {
  it("percent-encodes the spaces real consolidated filenames contain", () => {
    expect(rawUrl("sky-ecosystem/next-gen-atlas", "abc123", "content/A.2 - The-Support-Scope.md")).toBe(
      "https://raw.githubusercontent.com/sky-ecosystem/next-gen-atlas/abc123/content/A.2%20-%20The-Support-Scope.md",
    );
  });
});
