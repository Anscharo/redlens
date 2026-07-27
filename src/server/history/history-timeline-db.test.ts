// Post-migration edit history grouping (history-timeline-db.ts). Only the pure
// row-grouping is unit-tested — the SQL query itself needs a live Postgres.
import { describe, it, expect } from "vitest";
import { groupPostMigrationRows, fetchPostMigrationHistory, type PostMigrationRow } from "./history-timeline-db.ts";

// Fake bun SQL: a tagged-template call (first arg has `.raw`) resolves to `rows`;
// the inline `sql(docIds)` array-fragment helper call is routed through the same
// function and its return value is just an opaque substitution — same convention
// used by first-seen.test.ts for the real db.ts sql tag.
function fakeSql(rows: PostMigrationRow[]) {
  return Object.assign(
    (first: unknown) =>
      first && typeof first === "object" && "raw" in (first as object)
        ? Promise.resolve(rows)
        : { __fragment: first },
    {},
  );
}

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

describe("fetchPostMigrationHistory", () => {
  it("short-circuits on empty docIds without querying", async () => {
    let called = false;
    const sql = Object.assign(() => { called = true; return Promise.resolve([]); }, {});
    const result = await fetchPostMigrationHistory(sql as any, [], 100);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("queries and groups rows via groupPostMigrationRows", async () => {
    const rows: PostMigrationRow[] = [
      { doc_id: "d1", commit_seq: 101, committed_at: "2024-04-01", change_type: "content", pr_title: "Update X" },
      { doc_id: "d1", commit_seq: 110, committed_at: "2024-06-01", change_type: "removed", pr_title: "Remove X" },
    ];
    const sql = fakeSql(rows);
    const result = await fetchPostMigrationHistory(sql as any, ["d1"], 50);
    expect(result.get("d1")).toEqual({ edits: [{ date: "2024-04-01", prTitle: "Update X" }], deletedAt: "2024-06-01" });
  });
});
