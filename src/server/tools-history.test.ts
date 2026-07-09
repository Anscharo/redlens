// Pure aggregation tests for atlas_history_stats. The DB-backed handler is a
// thin SELECT wrapper; these cover the bucket/group/top-list behavior without a
// live Postgres dependency.
import { test, expect } from "bun:test";
import { summarizeHistoryStats, type HistoryStatsRow } from "./tools-history.ts";

function row(overrides: Partial<HistoryStatsRow>): HistoryStatsRow {
  return {
    doc_id: "d1",
    committed_at: "2025-05-28",
    change_type: "content",
    change_kind: null,
    review_count: null,
    approval_count: null,
    comment_count: null,
    pr_number: null,
    pr_title: null,
    pr_author: null,
    pr_url: null,
    doc_no: "A.1",
    title: "Doc 1",
    doc_type: "Core",
    scope: "A Agent",
    ...overrides,
  };
}

test("summarizeHistoryStats buckets by quarter and exposes availability warnings", () => {
  const result = summarizeHistoryStats(
    [
      row({ doc_id: "d1", committed_at: "2025-05-28", change_type: "content", change_kind: "meaningful", approval_count: 1 }),
      row({ doc_id: "d1", committed_at: "2025-06-15", change_type: "structural", doc_type: "Section", review_count: 2 }),
      row({ doc_id: "d2", committed_at: "2025-07-02", change_type: "added", scope: "G Governance", pr_author: "alice" }),
    ],
    {
      since: "2024-01-01",
      until: "2026-01-01",
      bucket: "quarter",
      group_by: ["doc_type", "scope", "change_kind", "review_status", "pr_author"],
      include_top_docs: false,
      include_prs: false,
      limit: 20,
      earliest_available_date: "2025-05-28",
      latest_available_date: "2025-07-02",
    },
  ) as Record<string, any>;

  expect(result.earliest_available_date).toBe("2025-05-28");
  expect(result.latest_available_date).toBe("2025-07-02");
  expect(result.warnings).toEqual([
    "Requested since=2024-01-01, but history starts at 2025-05-28.",
    "Requested until=2026-01-01, but latest history event is 2025-07-02.",
  ]);
  expect(result.buckets.map((b: any) => b.bucket)).toEqual(["2025-Q2", "2025-Q3"]);
  expect(result.buckets[0]).toMatchObject({
    total: 2,
    change_types: { modified: 1, moved: 1 },
    groups: {
      doc_type: { Core: 1, Section: 1 },
      scope: { "A Agent": 2 },
      change_kind: { meaningful: 1, unspecified: 1 },
      review_status: { approved: 1, reviewed: 1 },
      pr_author: { unknown: 2 },
    },
  });
});

test("summarizeHistoryStats returns top docs and PRs with month buckets", () => {
  const result = summarizeHistoryStats(
    [
      row({ doc_id: "d1", committed_at: new Date("2025-06-01T12:00:00Z"), change_type: "content", pr_number: 10, pr_title: "Edit d1", pr_author: "alice", pr_url: "https://example.test/10" }),
      row({ doc_id: "d1", committed_at: "2025-06-02", change_type: "removed", pr_number: 10, pr_title: "Edit d1", pr_author: "alice", pr_url: "https://example.test/10" }),
      row({ doc_id: "d2", doc_no: "A.2", title: "Doc 2", committed_at: "2025-06-03", change_type: "added", pr_number: 11, pr_title: "Add d2", pr_author: "bob", pr_url: "https://example.test/11" }),
    ],
    {
      bucket: "month",
      group_by: [],
      include_top_docs: true,
      include_prs: true,
      limit: 1,
    },
  ) as Record<string, any>;

  expect(result.buckets).toEqual([{ bucket: "2025-06", total: 3, change_types: { modified: 1, added: 1, removed: 1 } }]);
  expect(result.top_docs).toEqual([
    { id: "d1", doc_no: "A.1", title: "Doc 1", type: "Core", count: 2, change_types: { modified: 1, removed: 1 } },
  ]);
  expect(result.prs).toEqual([
    { pr_number: 10, title: "Edit d1", author: "alice", url: "https://example.test/10", count: 2, first_date: "2025-06-01", last_date: "2025-06-02" },
  ]);
});
