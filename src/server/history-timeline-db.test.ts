// Post-migration edit history grouping (history-timeline-db.ts). Only the pure
// row-grouping is unit-tested — the SQL query itself needs a live Postgres.
import { describe, it, expect } from "vitest";
import { groupPostMigrationRows, type PostMigrationRow } from "./history-timeline-db.ts";

describe("groupPostMigrationRows", () => {
  it("groups edits by doc_id, most-recent-first, ignoring removed rows as edits", () => {
    const rows: PostMigrationRow[] = [
      { doc_id: "d1", commit_seq: 101, committed_at: "2024-04-01", change_type: "content", pr_title: "Update X" },
      { doc_id: "d1", commit_seq: 105, committed_at: "2024-05-01", change_type: "content", pr_title: "Update X again" },
      { doc_id: "d2", commit_seq: 102, committed_at: "2024-04-02", change_type: "structural", pr_title: "Move Y" },
    ];
    const out = groupPostMigrationRows(rows);
    expect(out.get("d1")).toEqual({
      edits: [
        { date: "2024-05-01", prTitle: "Update X again" },
        { date: "2024-04-01", prTitle: "Update X" },
      ],
      deletedAt: null,
    });
    expect(out.get("d2")).toEqual({ edits: [{ date: "2024-04-02", prTitle: "Move Y" }], deletedAt: null });
  });

  it("records deletedAt from a removed row without adding it to edits", () => {
    const rows: PostMigrationRow[] = [
      { doc_id: "d1", commit_seq: 101, committed_at: "2024-04-01", change_type: "content", pr_title: "Update X" },
      { doc_id: "d1", commit_seq: 110, committed_at: "2024-06-01", change_type: "removed", pr_title: "Remove X" },
    ];
    const out = groupPostMigrationRows(rows);
    expect(out.get("d1")).toEqual({ edits: [{ date: "2024-04-01", prTitle: "Update X" }], deletedAt: "2024-06-01" });
  });

  it("returns an empty map for no rows", () => {
    expect(groupPostMigrationRows([]).size).toBe(0);
  });
});
