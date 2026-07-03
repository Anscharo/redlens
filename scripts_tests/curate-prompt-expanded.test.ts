// Final-escalation prompt assembly for the hardest residual curation cases. Pure
// string templating (curate-prompt-expanded.mjs) — no LLM call to test, just shape.
import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types
import { SYSTEM_EXPANDED, buildExpandedUser } from "../scripts/lib/curate-prompt-expanded.mjs";

describe("SYSTEM_EXPANDED", () => {
  it("defines the three-way verdict and forbids forcing a match or defaulting to born", () => {
    expect(SYSTEM_EXPANDED).toContain('"verdict":"match"|"born"|"widen"');
    expect(SYSTEM_EXPANDED).toContain("widen");
    expect(SYSTEM_EXPANDED).toMatch(/NEVER.*force|NEVER pick the best-of-a-bad-set/);
  });
});

describe("buildExpandedUser", () => {
  const subject = { title: "Newer Doc", content: "the newer body", context: { scope: "Governance", docNo: "A.1", prev: ["P"], next: ["N"] } };
  const candidates = [
    { key: "cand1", title: "Cand One", content: "older body one", diff: "- old\n+ new", soleHome: true, alsoClaimedBy: 0 },
    { key: "cand2", title: "Cand Two", content: "older body two", soleHome: false, alsoClaimedBy: 2 },
  ];

  it("includes the change block, candidates, position, diff, and sole-home/claimed notes", () => {
    const out = buildExpandedUser(subject, candidates, { change: { pr: 42, title: "Update the thing", summary: "did a thing" } });
    expect(out).toContain("THE CHANGE that produced the newer document (PR #42): Update the thing");
    expect(out).toContain("did a thing");
    expect(out).toContain("NEWER document:\n[Newer Doc] the newer body");
    expect(out).toContain("scope: Governance");
    expect(out).toContain("key=cand1\n[Cand One] older body one");
    expect(out).toContain("CHANGES → newer:\n- old\n+ new");
    expect(out).toContain("no other document lists this candidate");
    expect(out).toContain("also a candidate for 2 other document(s)");
  });

  it("omits the change block entirely when there's no change context", () => {
    const out = buildExpandedUser(subject, candidates, {});
    expect(out).not.toContain("THE CHANGE that produced");
  });

  it("renders candidate INTRODUCED/LAST HTML EDIT lines from timeline data", () => {
    const withTimeline = [{ ...candidates[0], timeline: {
      firstSeen: { sha: "aaa", date: "2024-01-01", pr: 5, title: "Add it", summary: "adding" },
      lastEdit: { sha: "bbb", date: "2024-06-01", pr: 9, title: "Tweak it", summary: null },
    } }];
    const out = buildExpandedUser(subject, withTimeline);
    expect(out).toContain("INTRODUCED: 2024-01-01 (PR #5: Add it — adding)");
    expect(out).toContain("LAST HTML EDIT: 2024-06-01 (PR #9: Tweak it)");
  });

  it("renders the subject's POST-MIGRATION note: edits, deletion, or untouched", () => {
    const edited = buildExpandedUser({ ...subject, postMigration: { edits: [{ date: "2025-01-01", prTitle: "Later edit" }], deletedAt: null } }, candidates);
    expect(edited).toContain('POST-MIGRATION: 1 edit(s) since migration, most recent 2025-01-01 — "Later edit"');

    const deleted = buildExpandedUser({ ...subject, postMigration: { edits: [], deletedAt: "2025-02-02" } }, candidates);
    expect(deleted).toContain("POST-MIGRATION: deleted 2025-02-02");

    const untouched = buildExpandedUser({ ...subject, postMigration: { edits: [], deletedAt: null } }, candidates);
    expect(untouched).toContain("POST-MIGRATION: untouched since migration");
  });

  it("is a no-op for timeline/postMigration when absent", () => {
    const out = buildExpandedUser(subject, candidates);
    expect(out).not.toContain("INTRODUCED");
    expect(out).not.toContain("POST-MIGRATION");
  });
});
