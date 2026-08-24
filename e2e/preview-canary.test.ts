import { describe, expect, it } from "vitest";
import { changedDocIds, splitByUuid } from "./atlas-sections";
import { CONTENT_FILE_RE, rawUrl } from "./preview-canary";

const SCOPE = [
  "# A.1 - The Governance Scope [Scope]  <!-- UUID: 18ac7dd3-c646-4352-9b0d-d01a2932d7d1 -->",
  "Preamble text.",
  "## A.1.1 - Spirit of the Atlas [Article]  <!-- UUID: 86A93DAB-2f12-4c3f-9285-bcc4520c851b -->",
  "Article body line one.",
  "Article body line two.",
].join("\n");

describe("splitByUuid", () => {
  it("splits a consolidated file into per-doc field sections, lowercasing ids", () => {
    const docs = splitByUuid(SCOPE);
    expect([...docs.keys()]).toEqual([
      "18ac7dd3-c646-4352-9b0d-d01a2932d7d1",
      "86a93dab-2f12-4c3f-9285-bcc4520c851b",
    ]);
    expect(docs.get("18ac7dd3-c646-4352-9b0d-d01a2932d7d1")).toEqual({
      doc_no: "A.1",
      title: "The Governance Scope",
      body: "Preamble text.",
    });
    expect(docs.get("86a93dab-2f12-4c3f-9285-bcc4520c851b")?.body).toBe(
      "Article body line one.\nArticle body line two.",
    );
  });

  it("ignores prose before the first UUID heading and headings without a UUID marker", () => {
    const docs = splitByUuid("intro\n## Plain Heading\n" + SCOPE);
    expect(docs.size).toBe(2);
    // The plain heading before the first UUID heading is not a section; a
    // plain heading INSIDE a section stays part of that section's body.
    const withInner = splitByUuid(SCOPE + "\n### Inner Plain Heading\nmore body");
    expect(withInner.get("86a93dab-2f12-4c3f-9285-bcc4520c851b")?.body).toContain("Inner Plain Heading");
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

  it("flags renumber-only and retitle-only edits (preview diffs doc_no and title)", () => {
    expect(changedDocIds(base, splitByUuid(SCOPE.replace("## A.1.1 -", "## A.1.2 -")))).toEqual([
      "86a93dab-2f12-4c3f-9285-bcc4520c851b",
    ]);
    expect(
      changedDocIds(base, splitByUuid(SCOPE.replace("Spirit of the Atlas", "Soul of the Atlas"))),
    ).toEqual(["86a93dab-2f12-4c3f-9285-bcc4520c851b"]);
  });

  it("does NOT flag type-only or heading-whitespace edits — the preview's diff ignores them", () => {
    // diffSnapshots compares body/title/doc_no only; [Type] and heading
    // formatting are not hashed, so expecting these would be a false red.
    expect(changedDocIds(base, splitByUuid(SCOPE.replace("[Article]", "[Core]")))).toEqual([]);
    expect(
      changedDocIds(base, splitByUuid(SCOPE.replace("Spirit of the Atlas [Article]", "Spirit of the Atlas  [Article]"))),
    ).toEqual([]);
  });

  it("does not flag a doc moved between files when the union fields are identical", () => {
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
