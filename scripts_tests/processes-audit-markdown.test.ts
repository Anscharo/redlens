// The process-inventory audit as markdown: a header with the counts, then one
// section per kind of drift, each present only when it has something to show.
import { describe, it, expect } from "vitest";
import { renderMarkdown, type ProcessesAudit } from "../scripts/lib/processes-audit-markdown.ts";

const clean: ProcessesAudit = {
  generated_at: "2026-11-06T00:00:00Z",
  total_curated: 40,
  total_candidates: 0,
  total_ignored: 3,
  atlas_diff: { since_atlas_sha: "a".repeat(40), current_atlas_sha: "a".repeat(40), added_uuids: [] },
  missing_uuids: [],
  new_candidates: [],
};

describe("renderMarkdown", () => {
  it("a clean audit shows the counts and says there is nothing to review", () => {
    const md = renderMarkdown(clean, false);
    expect(md).toContain("**Status:** clean");
    expect(md).toContain("Curated: 40 · Candidates: 0 · Ignored: 3");
    expect(md).not.toContain("Atlas diff");
    expect(md).not.toContain("## ");
    expect(md.endsWith("Nothing to review.")).toBe(true);
  });

  it("a dirty audit lists the atlas diff, the missing UUIDs and the candidates, starring recent ones", () => {
    const md = renderMarkdown(
      {
        ...clean,
        total_candidates: 2,
        atlas_diff: { since_atlas_sha: "1234567890abcdef", current_atlas_sha: "fedcba0987654321", added_uuids: ["u1", "u2"] },
        missing_uuids: [{ uuid: "gone-uuid", category: "governance" }],
        new_candidates: [
          { uuid: "c1", title: "Emergency Process", doc_no: "A.1.2", type: "Core", keywords: ["process", "emergency"], recently_added: true },
          { uuid: "c2", title: "Old Process", doc_no: "A.3.4", type: "Section", keywords: ["process"], recently_added: false },
        ],
      },
      true,
    );
    expect(md).toContain("**Status:** needs review");
    expect(md).toContain("**Atlas diff since last triage:** `12345678` → `fedcba09` · 2 new UUIDs added.");
    expect(md).toContain("## Missing UUIDs (1)");
    expect(md).toContain("- `gone-uuid` (governance)");
    expect(md).toContain("## New candidates (2, 1 ★ added since last triage)");
    expect(md).toContain("- ★ A.1.2 — **Emergency Process** (`c1`, Core) — keywords: process, emergency");
    expect(md).toContain("- A.3.4 — **Old Process** (`c2`, Section) — keywords: process");
    expect(md).not.toContain("Nothing to review.");
  });

  it("an unavailable atlas diff says why, and a candidate list with none recent omits the star count", () => {
    const md = renderMarkdown(
      {
        ...clean,
        atlas_diff: { since_atlas_sha: null, current_atlas_sha: null, added_uuids: [], error: "no submodule" },
        new_candidates: [{ uuid: "c3", title: "A Process", doc_no: "A.5", type: "Core", keywords: ["process"], recently_added: false }],
      },
      true,
    );
    expect(md).toContain("_(Atlas diff unavailable: no submodule)_");
    expect(md).toContain("## New candidates (1)");
  });
});
