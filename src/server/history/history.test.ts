// Run under `bun test` (NOT vitest) — imports Bun SQL transitively.
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { toEntry } from "./history.ts";

const VALID_UUID = "d0d77316-0b08-447c-b75a-ae7926b07019";
const VALID_UUID_2 = "f8225872-d517-40f1-a931-241b5d0cc07b";

// ── toEntry ──────────────────────────────────────────────────────────────────

describe("toEntry", () => {
  it("maps DB change_type synonyms to frontend vocabulary", () => {
    const cases = [
      ["content", "modified"],
      ["structural", "moved"],
      ["added", "added"],
      ["removed", "removed"],
    ] as const;
    for (const [dbVal, expected] of cases) {
      const entry = toEntry({
        commit_sha: "abc1234",
        commit_seq: null,
        committed_at: "2024-01-01",
        change_type: dbVal,
        pr_number: null,
        pr_title: null,
        pr_url: null,
        pr_author: null,
        summary: null,
        description: null,
        moved_from: null,
        moved_to: null,
        diff: null,
        change_kind: null,
        review_count: null,
        approval_count: null,
        comment_count: null,
        era: null,
        method: null,
        source_url: null,
        seam: null,
      });
      expect(entry.changeType, `change_type="${dbVal}"`).toBe(expected);
    }
  });

  it("passes through unknown change_type values unchanged", () => {
    const entry = toEntry({
      commit_sha: "abc1234",
      commit_seq: null,
      committed_at: "2024-01-01",
      change_type: "future_type",
      pr_number: null,
      pr_title: null,
      pr_url: null,
      pr_author: null,
      summary: null,
      description: null,
      moved_from: null,
      moved_to: null,
      diff: null,
      change_kind: null,
      review_count: null,
      approval_count: null,
      comment_count: null,
      era: null,
      method: null,
      source_url: null,
      seam: null,
    });
    expect(entry.changeType).toBe("future_type" as any);
  });

  it("sets date to empty string when committed_at is null", () => {
    const entry = toEntry({
      commit_sha: "abc1234",
      commit_seq: null,
      committed_at: null,
      change_type: "added",
      pr_number: null,
      pr_title: null,
      pr_url: null,
      pr_author: null,
      summary: null,
      description: null,
      moved_from: null,
      moved_to: null,
      diff: null,
      change_kind: null,
      review_count: null,
      approval_count: null,
      comment_count: null,
      era: null,
      method: null,
      source_url: null,
      seam: null,
    });
    expect(entry.date).toBe("");
  });

  it("omits optional fields when null", () => {
    const entry = toEntry({
      commit_sha: "abc1234",
      commit_seq: null,
      committed_at: "2024-01-01",
      change_type: "added",
      pr_number: null,
      pr_title: null,
      pr_url: null,
      pr_author: null,
      summary: null,
      description: null,
      moved_from: null,
      moved_to: null,
      diff: null,
      change_kind: null,
      review_count: null,
      approval_count: null,
      comment_count: null,
      era: null,
      method: null,
      source_url: null,
      seam: null,
    });
    expect("pr" in entry).toBe(false);
    expect("prTitle" in entry).toBe(false);
    expect("prAuthor" in entry).toBe(false);
    expect("prUrl" in entry).toBe(false);
    expect("summary" in entry).toBe(false);
    expect("description" in entry).toBe(false);
    expect("diff" in entry).toBe(false);
    expect("movedFrom" in entry).toBe(false);
    expect("movedTo" in entry).toBe(false);
    expect("changeKind" in entry).toBe(false);
    expect("reviewCount" in entry).toBe(false);
    expect("approvalCount" in entry).toBe(false);
    expect("commentCount" in entry).toBe(false);
    expect("era" in entry).toBe(false);
    expect("method" in entry).toBe(false);
  });

  it("maps all optional fields when present", () => {
    const diff = [["+", "new line"]] as any;
    const entry = toEntry({
      commit_sha: "abc1234",
      commit_seq: 42,
      committed_at: "2024-03-15",
      change_type: "structural",
      pr_number: 42,
      pr_title: "Add Scope",
      pr_url: "https://github.com/org/repo/pull/42",
      pr_author: "alice",
      summary: "Add Scope X",
      description: "Adds the new scope.",
      moved_from: "A.1.2",
      moved_to: "A.1.3",
      diff,
      change_kind: "typo",
      review_count: 3,
      approval_count: 2,
      comment_count: 5,
      era: "html",
      method: "deterministic",
      source_url: "https://example.com/source",
      seam: null,
    });
    expect(entry.date).toBe("2024-03-15");
    expect(entry.commitHash).toBe("abc1234");
    expect(entry.changeType).toBe("moved");
    expect(entry.pr).toBe(42);
    expect(entry.prTitle).toBe("Add Scope");
    expect(entry.prUrl).toBe("https://github.com/org/repo/pull/42");
    expect(entry.prAuthor).toBe("alice");
    expect(entry.summary).toBe("Add Scope X");
    expect(entry.description).toBe("Adds the new scope.");
    expect(entry.movedFrom).toBe("A.1.2");
    expect(entry.movedTo).toBe("A.1.3");
    expect(entry.diff).toBe(diff);
    expect(entry.changeKind).toBe("typo");
    expect(entry.reviewCount).toBe(3);
    expect(entry.approvalCount).toBe(2);
    expect(entry.commentCount).toBe(5);
    expect(entry.era).toBe("html");
    expect(entry.method).toBe("deterministic");
    expect(entry.commitSeq).toBe(42);
    expect(entry.sourceUrl).toBe("https://example.com/source");
  });

  const baseRow = {
    commit_sha: "abc1234",
    commit_seq: null,
    change_type: "added",
    pr_number: null,
    pr_title: null,
    pr_url: null,
    pr_author: null,
    summary: null,
    description: null,
    moved_from: null,
    moved_to: null,
    change_kind: null,
    review_count: null,
    approval_count: null,
    comment_count: null,
    era: null,
    method: null,
    source_url: null,
    seam: null,
  } as const;

  it("coerces a legacy double-encoded (string) diff back to an array", () => {
    const entry = toEntry({
      ...baseRow,
      committed_at: "2024-01-01",
      diff: '[["+","new line"]]' as any,
    });
    expect(entry.diff).toEqual([["+", "new line"]]);
  });

  it("drops a diff string that is not valid JSON", () => {
    const entry = toEntry({ ...baseRow, committed_at: "2024-01-01", diff: "not json" as any });
    expect("diff" in entry).toBe(false);
  });

  it("drops a diff whose JSON is not an array", () => {
    const entry = toEntry({ ...baseRow, committed_at: "2024-01-01", diff: '{"x":1}' as any });
    expect("diff" in entry).toBe(false);
  });

  it("normalises a Date committed_at to YYYY-MM-DD", () => {
    const entry = toEntry({
      ...baseRow,
      committed_at: new Date("2026-05-20T10:09:52-07:00") as any,
      diff: null,
    });
    expect(entry.date).toBe("2026-05-20");
  });

  it("normalises an ISO-string committed_at to YYYY-MM-DD", () => {
    const entry = toEntry({ ...baseRow, committed_at: "2026-05-20T00:00:00.000Z", diff: null });
    expect(entry.date).toBe("2026-05-20");
  });
});

// ── handleHistory ─────────────────────────────────────────────────────────────

describe("handleHistory", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("returns 404 for a non-UUID path segment", async () => {
    const { handleHistory } = await import("./history.ts");
    const res = await handleHistory(new Request("http://x/api/history/not-a-uuid"), "/api/history/not-a-uuid");
    expect(res.status).toBe(404);
  });

  it("returns 404 for an empty segment", async () => {
    const { handleHistory } = await import("./history.ts");
    const res = await handleHistory(new Request("http://x/api/history/"), "/api/history/");
    expect(res.status).toBe(404);
  });

  it("returns JSON array with mapped entries on success", async () => {
    mock.module("../db.ts", () => ({
      sql: Object.assign(
        () =>
          Promise.resolve([
            {
              commit_sha: "aaa0001",
              commit_seq: 10,
              committed_at: "2024-06-01",
              change_type: "content",
              pr_number: 10,
              pr_title: "Fix typo",
              pr_url: null,
              pr_author: null,
              summary: null,
              description: null,
              moved_from: null,
              moved_to: null,
              diff: null,
              source_url: null,
            },
          ]),
        { mock: true },
      ),
    }));
    const { handleHistory } = await import("./history.ts");
    const res = await handleHistory(
      new Request(`http://x/api/history/${VALID_UUID}`),
      `/api/history/${VALID_UUID}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body).toHaveLength(1);
    expect(body[0].changeType).toBe("modified");
    expect(body[0].pr).toBe(10);
    expect(body[0].prTitle).toBe("Fix typo");
    expect("prUrl" in body[0]).toBe(false);
  });

  it("returns 503 when the DB throws", async () => {
    mock.module("../db.ts", () => ({
      sql: Object.assign(() => Promise.reject(new Error("connection refused")), { mock: true }),
    }));
    const { handleHistory } = await import("./history.ts");
    const res = await handleHistory(
      new Request(`http://x/api/history/${VALID_UUID}`),
      `/api/history/${VALID_UUID}`,
    );
    expect(res.status).toBe(503);
  });

  it("sets Cache-Control on successful response", async () => {
    mock.module("../db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), { mock: true }),
    }));
    const { handleHistory } = await import("./history.ts");
    const res = await handleHistory(
      new Request(`http://x/api/history/${VALID_UUID}`),
      `/api/history/${VALID_UUID}`,
    );
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
  });
});

// ── handleHistoryBatch ────────────────────────────────────────────────────────

function batchReq(body: unknown): Request {
  return new Request("http://x/api/history/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleHistoryBatch", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const { handleHistoryBatch } = await import("./history.ts");
    const res = await handleHistoryBatch(
      new Request("http://x/api/history/batch", { method: "POST", body: "{not json" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when ids is missing or not an array", async () => {
    const { handleHistoryBatch } = await import("./history.ts");
    expect((await handleHistoryBatch(batchReq({}))).status).toBe(400);
    expect((await handleHistoryBatch(batchReq({ ids: "nope" }))).status).toBe(400);
  });

  it("returns {} without touching the DB when no valid UUIDs are given", async () => {
    let called = false;
    mock.module("../db.ts", () => ({
      sql: Object.assign(() => { called = true; return Promise.resolve([]); }, { mock: true }),
    }));
    const { handleHistoryBatch } = await import("./history.ts");
    const res = await handleHistoryBatch(batchReq({ ids: ["not-a-uuid", 42, null] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect(called).toBe(false);
  });

  it("groups rows by doc_id and maps entries", async () => {
    mock.module("../db.ts", () => ({
      sql: Object.assign(
        () =>
          Promise.resolve([
            { doc_id: VALID_UUID, commit_sha: "aaa0001", commit_seq: 10, committed_at: "2024-06-01",
              change_type: "content", pr_number: 10, pr_title: "Fix typo", pr_url: null,
              pr_author: null, summary: null, description: null, moved_from: null, moved_to: null, diff: null,
              change_kind: null, review_count: null, approval_count: null, comment_count: null, era: null, method: null, source_url: null },
            { doc_id: VALID_UUID, commit_sha: "aaa0002", commit_seq: 9, committed_at: "2024-05-01",
              change_type: "added", pr_number: null, pr_title: null, pr_url: null,
              pr_author: null, summary: null, description: null, moved_from: null, moved_to: null, diff: null,
              change_kind: null, review_count: null, approval_count: null, comment_count: null, era: null, method: null, source_url: null },
            { doc_id: VALID_UUID_2, commit_sha: "bbb0001", commit_seq: 8, committed_at: "2024-04-01",
              change_type: "removed", pr_number: null, pr_title: null, pr_url: null,
              pr_author: null, summary: null, description: null, moved_from: null, moved_to: null, diff: null,
              change_kind: null, review_count: null, approval_count: null, comment_count: null, era: null, method: null, source_url: null },
          ]),
        { mock: true },
      ),
    }));
    const { handleHistoryBatch } = await import("./history.ts");
    const res = await handleHistoryBatch(batchReq({ ids: [VALID_UUID, VALID_UUID_2] }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any[]>;
    expect(body[VALID_UUID]).toHaveLength(2);
    expect(body[VALID_UUID][0].changeType).toBe("modified");
    expect(body[VALID_UUID_2]).toHaveLength(1);
    expect(body[VALID_UUID_2][0].changeType).toBe("removed");
  });

  it("returns 503 when the DB throws", async () => {
    mock.module("../db.ts", () => ({
      // `sql(ids)` (the array-fragment helper) is called with a plain array and
      // must return a benign placeholder; only the tagged-template query (first
      // arg is a TemplateStringsArray, which has `.raw`) rejects.
      sql: Object.assign(
        (first: unknown) =>
          Array.isArray(first) && !("raw" in (first as object))
            ? { __fragment: first }
            : Promise.reject(new Error("connection refused")),
        { mock: true },
      ),
    }));
    const { handleHistoryBatch } = await import("./history.ts");
    const res = await handleHistoryBatch(batchReq({ ids: [VALID_UUID] }));
    expect(res.status).toBe(503);
  });
});
