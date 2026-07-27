// Targeted tests for the DB-backed history tools (atlasHistory, atlasRecentChanges,
// atlasHistoryStats's DB wrapper, atlasPr, atlasChangedBetween). Run under `bun
// test` (NOT vitest). summarizeHistoryStats's own bucket/group logic is already
// covered by tools-history.test.ts's pure tests; this file exercises the SQL
// wiring + row-shaping + branch selection around it, with "../../db.ts" mocked
// (bun's mock.module patches the module in place — see tool-registry.test.ts's
// header comment for why this works regardless of import order).
import { test, expect, mock, beforeEach } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity, type Edge, type Indexes } from "../../retrieval/indexes.ts";

function mockDb(rows: unknown[] | ((callIndex: number) => unknown[])) {
  let call = 0;
  const next = () => (typeof rows === "function" ? rows(call++) : rows);
  const fn = Object.assign(
    (..._args: unknown[]) => Promise.resolve(next()),
    { unsafe: (..._args: unknown[]) => Promise.resolve(next()) },
  );
  mock.module("../../db.ts", () => ({
    sql: fn,
    toVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
    dbTarget: () => "mock:5432/db",
    waitForDb: async () => {},
  }));
}

function doc(id: string, doc_no: string, type: string, depth: number, parentId: string | null): AtlasNode {
  return { id, doc_no, title: id, type, depth, parentId, order: 0, content: `content ${id}`, addressRefs: [] } as AtlasNode;
}
function entity(id: string, slug: string, entity_type: string, subtype: string | null, defining_doc_id: string | null): Entity {
  return { id, slug, name: slug, entity_type, subtype, defining_doc_id, is_active: 1, meta: null };
}

function makeIx(): Indexes {
  const docs = [
    doc("D0", "A.1", "Core", 1, null),
    doc("D1", "A.1.1", "Core", 2, "D0"),
    doc("D2", "A.1.2", "Core", 1, null),
  ];
  const edges: Edge[] = [
    { id: 1, from_id: "E", from_type: "entity", to_id: "D1", to_type: "doc", edge_type: "responsible_party_for", source_doc_nos: null, weight: 1, meta: null },
  ];
  const entities: Entity[] = [entity("E", "ent", "agent", "prime", "D0")];
  return buildIndexes(docs, entities, edges, {});
}

beforeEach(() => {
  mock.restore();
});

// ── atlas_history ──────────────────────────────────────────────────────────
test("atlasHistory resolves the node and shapes rows (with_diff on)", async () => {
  mockDb([
    { doc_id: "D1", commit_sha: "abc1234", commit_seq: 3, committed_at: "2025-01-01", change_type: "content", pr_number: 5, pr_title: "t", pr_author: "a", pr_url: "u", summary: "s", description: "d", moved_from: null, moved_to: null, era: null, method: null, source_url: null, diff: { added: ["x"] } },
  ]);
  const { atlasHistory } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = (await atlasHistory(ix, "D1", { with_diff: true })) as { doc: Record<string, unknown>; count: number; events: Array<Record<string, unknown>> };
  expect(res.doc).toMatchObject({ id: "D1", doc_no: "A.1.1" });
  expect(res.count).toBe(1);
  expect(res.events[0].change_type).toBe("modified"); // "content" -> user-facing "modified"
  expect(res.events[0].diff).toEqual({ added: ["x"] });
});

test("atlasHistory returns {error} for an unresolvable, non-UUID id", async () => {
  mockDb([]);
  const { atlasHistory } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = await atlasHistory(ix, "not-a-real-id", {});
  expect(res).toEqual({ error: "Not found" });
});

test("atlasHistory accepts a bare UUID with no matching doc (history for a deleted node)", async () => {
  mockDb([]);
  const { atlasHistory } = await import("./tools-history.ts");
  const ix = makeIx();
  const uuid = "11111111-2222-3333-4444-555555555555";
  const res = (await atlasHistory(ix, uuid, { since: "2024-01-01", until: "2026-01-01", pr: 5, change_type: "moved" })) as { doc: Record<string, unknown> };
  expect(res.doc).toEqual({ id: uuid });
});

// ── atlas_recent_changes ──────────────────────────────────────────────────
test("atlasRecentChanges errors on an unknown entity slug", async () => {
  mockDb([]);
  const { atlasRecentChanges } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = await atlasRecentChanges(ix, { entity: "nope", k: 10 });
  expect(res).toEqual({ error: "Entity 'nope' not found" });
});

test("atlasRecentChanges short-circuits with an empty result when the entity has no linked docs", async () => {
  mockDb([]);
  const { atlasRecentChanges } = await import("./tools-history.ts");
  const ix = makeIx();
  // "ent" resolves but has no responsible_party_for/etc. edges in this fixture's D0-rooted set... it does (D1 via E).
  // Use a differently-shaped fixture entity with zero linked docs instead: reuse buildIndexes directly.
  const ix2 = buildIndexes([doc("D0", "A.1", "Core", 1, null)], [entity("E2", "empty-ent", "agent", "prime", "D0")], [], {});
  const res = await atlasRecentChanges(ix2, { entity: "empty-ent", k: 10 });
  expect(res).toEqual({ since: expect.any(String), count: 0, events: [] });
  void ix;
});

test("atlasRecentChanges applies default since, entity filter, and shapes rows", async () => {
  mockDb([
    { doc_id: "D1", commit_sha: "abc1234", commit_seq: 1, committed_at: "2025-06-01", change_type: "added", pr_number: null, pr_title: null, pr_author: null, pr_url: null, summary: null, description: null, moved_from: null, moved_to: null, era: null, method: null, source_url: null, doc_no: "A.1.1", title: "D1", doc_type: "Core" },
  ]);
  const { atlasRecentChanges } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = (await atlasRecentChanges(ix, { entity: "ent", type: "Core", change_type: "added", until: "2026-01-01", k: 10 })) as {
    since: string; count: number; events: Array<{ change_type: string }>;
  };
  expect(res.count).toBe(1);
  expect(res.events[0].change_type).toBe("added");
});

test("atlasRecentChanges without an entity filter still runs (global recent-changes path)", async () => {
  mockDb([]);
  const { atlasRecentChanges } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = (await atlasRecentChanges(ix, { since: "2025-01-01", k: 5 })) as { count: number };
  expect(res.count).toBe(0);
});

// ── atlas_pr ───────────────────────────────────────────────────────────────
test("atlasPr shapes the PR summary from its first row, or nulls when no rows", async () => {
  mockDb([]);
  const { atlasPr } = await import("./tools-history.ts");
  const ix = makeIx();
  const empty = (await atlasPr(ix, 999)) as { pr: Record<string, unknown>; count: number };
  expect(empty.pr).toEqual({ number: 999, title: null, author: null, url: null });
  expect(empty.count).toBe(0);

  mockDb([
    { doc_id: "D1", commit_sha: "abc1234", commit_seq: 1, committed_at: "2025-01-01", change_type: "structural", pr_title: "My PR", pr_author: "alice", pr_url: "https://x", summary: null, description: null, moved_from: "A.1", moved_to: "A.2", era: null, method: null, source_url: null, doc_no: "A.1.1", title: "D1", doc_type: "Core" },
  ]);
  const { atlasPr: atlasPr2 } = await import("./tools-history.ts");
  const withRows = (await atlasPr2(ix, 42)) as { pr: Record<string, unknown>; count: number; events: Array<{ change_type: string }> };
  expect(withRows.pr).toMatchObject({ number: 42, title: "My PR", author: "alice" });
  expect(withRows.events[0].change_type).toBe("moved"); // "structural" -> "moved"
});

// ── atlas_changed_between ──────────────────────────────────────────────────
test("atlasChangedBetween errors when either boundary commit isn't found", async () => {
  mockDb([]);
  const { atlasChangedBetween } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = await atlasChangedBetween(ix, { commit_a: "aaaaaaa", commit_b: "bbbbbbb", limit: 10 });
  expect(res).toEqual({ error: "commit_a 'aaaaaaa' not found in history" });
});

test("atlasChangedBetween errors on an unresolvable ancestor_id", async () => {
  mockDb((call) => (call < 2 ? [{ commit_seq: call + 1 }] : []));
  const { atlasChangedBetween } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = await atlasChangedBetween(ix, { commit_a: "aaaaaaa", commit_b: "bbbbbbb", ancestor_id: "not-a-node", limit: 10 });
  expect(res).toEqual({ error: "ancestor_id 'not-a-node' not found" });
});

test("atlasChangedBetween errors on an unknown entity filter", async () => {
  mockDb((call) => (call < 2 ? [{ commit_seq: call + 1 }] : []));
  const { atlasChangedBetween } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = await atlasChangedBetween(ix, { commit_a: "aaaaaaa", commit_b: "bbbbbbb", entity: "nope", limit: 10 });
  expect(res).toEqual({ error: "Entity 'nope' not found" });
});

test("atlasChangedBetween short-circuits when the entity has no linked docs", async () => {
  mockDb((call) => (call < 2 ? [{ commit_seq: call + 1 }] : []));
  const { atlasChangedBetween } = await import("./tools-history.ts");
  const ix2 = buildIndexes([doc("D0", "A.1", "Core", 1, null)], [entity("E2", "empty-ent", "agent", "prime", "D0")], [], {});
  const res = await atlasChangedBetween(ix2, { commit_a: "aaaaaaa", commit_b: "bbbbbbb", entity: "empty-ent", limit: 10 });
  expect(res).toMatchObject({ commit_a: "aaaaaaa", doc_count: 0, docs: [] });
});

test("atlasChangedBetween resolves the full window with ancestor_id + change_type filters and shapes per-doc events", async () => {
  mockDb((call) => {
    if (call === 0) return [{ commit_seq: 1 }]; // commit_a
    if (call === 1) return [{ commit_seq: 5 }]; // commit_b
    return [
      { doc_id: "D1", commit_sha: "abc1234", commit_seq: 2, committed_at: "2025-01-01", change_type: "content", pr_number: 1, pr_title: "t", pr_author: "a", pr_url: "u", summary: "s", description: "d", moved_from: null, moved_to: null, doc_no: "A.1.1", title: "D1", doc_type: "Core" },
    ];
  });
  const { atlasChangedBetween } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = (await atlasChangedBetween(ix, { commit_a: "aaaaaaa", commit_b: "bbbbbbb", ancestor_id: "D0", change_type: "modified", limit: 50 })) as {
    seq_lo: number; seq_hi: number; doc_count: number; docs: Array<{ id: string; events: Array<{ change_type: string }> }>;
  };
  expect(res.seq_lo).toBe(1);
  expect(res.seq_hi).toBe(5);
  expect(res.doc_count).toBe(1);
  expect(res.docs[0].id).toBe("D1");
  expect(res.docs[0].events[0].change_type).toBe("modified");
});

// ── atlas_history_stats (DB wrapper) ───────────────────────────────────────
test("atlasHistoryStats fetches coverage bounds + rows and delegates to summarizeHistoryStats", async () => {
  mockDb((call) => {
    if (call === 0) return [{ earliest: "2025-01-01", latest: "2025-12-31" }];
    return [
      { doc_id: "D1", committed_at: "2025-06-01", change_type: "content", change_kind: null, review_count: null, approval_count: null, comment_count: null, pr_number: null, pr_title: null, pr_author: null, pr_url: null, doc_no: "A.1.1", title: "D1", doc_type: "Core" },
    ];
  });
  const { atlasHistoryStats } = await import("./tools-history.ts");
  const ix = makeIx();
  const res = (await atlasHistoryStats(ix, { bucket: "month", group_by: ["scope"], include_top_docs: true, include_prs: true, limit: 10 })) as {
    earliest_available_date: string; latest_available_date: string; buckets: Array<{ groups?: Record<string, unknown> }>;
  };
  expect(res.earliest_available_date).toBe("2025-01-01");
  expect(res.latest_available_date).toBe("2025-12-31");
  expect(res.buckets[0].groups?.scope).toBeDefined(); // scopeFor() resolved via ix.docMap ancestor walk
});
