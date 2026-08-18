// Pure unit tests for atlas_params. Run under `bun test` (NOT vitest).
import { test, expect } from "bun:test";
import { atlasParams } from "./tools-params.ts";
import { buildIndexes, type AtlasNode, type Indexes } from "../../retrieval/indexes.ts";
import type { ParamRow } from "../../../lib/paramIndex.ts";

function row(over: Partial<ParamRow> = {}): ParamRow {
  return {
    uuid: "u-1", doc_no: "A.1", name: "maxamount", value: "10,000 USDS", num: 10000, unit: "USDS",
    owner: null, context: "context text", source: "kv",
    ...over,
  };
}

// atlasParams only reads ix.params.rows — a minimal cast avoids pulling in a
// full Indexes fixture for pure match/rank/limit tests.
function fixtureIx(rows: ParamRow[]): Indexes {
  return { params: { rows, byUuid: new Map(), byName: new Map(), matchText: () => [] } } as unknown as Indexes;
}

// ── match ──────────────────────────────────────────────────────────────────
test("matches every query token of 3+ chars across name + owner + doc_no combined", () => {
  const rows = [
    row({ uuid: "a", name: "maxamount", owner: "keel", doc_no: "A.1" }),
    row({ uuid: "b", name: "liquidation ratio", owner: "spark", doc_no: "A.2" }),
  ];
  const res = atlasParams(fixtureIx(rows), { q: "keel maxamount", limit: 25 }) as { rows: Array<{ uuid: string }> };
  expect(res.rows.map((r) => r.uuid)).toEqual(["a"]);
});

test("a row must satisfy EVERY query token, not just one", () => {
  const rows = [row({ uuid: "a", name: "maxamount", owner: "keel", doc_no: "A.1" })];
  // "spark" doesn't appear anywhere on this row's name/owner/doc_no.
  const res = atlasParams(fixtureIx(rows), { q: "keel spark", limit: 25 }) as { rows: unknown[] };
  expect(res.rows).toEqual([]);
});

// ── ranking: owner-match outranks ─────────────────────────────────────────
test("an owner-matched row ranks above a same-query row matched only via name", () => {
  const rows = [
    // Matches "keel" through its own NAME (longer name, would otherwise sort first).
    row({ uuid: "name-match", name: "keel maxamount", owner: "grove", doc_no: "A.1" }),
    // Matches "keel" through its OWNER (shorter name).
    row({ uuid: "owner-match", name: "maxamount", owner: "keel", doc_no: "A.2" }),
  ];
  const res = atlasParams(fixtureIx(rows), { q: "keel maxamount", limit: 25 }) as { rows: Array<{ uuid: string }> };
  expect(res.rows.map((r) => r.uuid)).toEqual(["owner-match", "name-match"]);
});

test("row shape omits internal num/source fields", () => {
  const res = atlasParams(fixtureIx([row({ uuid: "a" })]), { q: "maxamount", limit: 25 }) as { rows: Array<Record<string, unknown>> };
  expect(res.rows[0]).toEqual({ uuid: "a", doc_no: "A.1", name: "maxamount", value: "10,000 USDS", unit: "USDS", owner: null, context: "context text" });
});

// ── limit / truncation ────────────────────────────────────────────────────
test("caps results at limit and flags truncated only when rows were actually cut", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ uuid: `u${i}`, name: `maxamount ${i}`, doc_no: `A.${i}` }));
  const ix = fixtureIx(rows);

  const capped = atlasParams(ix, { q: "maxamount", limit: 2 }) as { count: number; truncated?: boolean; rows: unknown[] };
  expect(capped.rows.length).toBe(2);
  expect(capped.count).toBe(2);
  expect(capped.truncated).toBe(true);

  const full = atlasParams(ix, { q: "maxamount", limit: 25 }) as { count: number; truncated?: boolean; rows: unknown[] };
  expect(full.rows.length).toBe(5);
  expect(full.truncated).toBeUndefined();
});

// ── empty query ────────────────────────────────────────────────────────────
test("an empty, whitespace-only, or all-short-token query errors instead of matching everything", () => {
  const ix = fixtureIx([row({})]);
  expect((atlasParams(ix, { q: "", limit: 25 }) as { error?: string }).error).toBeDefined();
  expect((atlasParams(ix, { q: "   ", limit: 25 }) as { error?: string }).error).toBeDefined();
  expect((atlasParams(ix, { q: "at of", limit: 25 }) as { error?: string }).error).toBeDefined(); // every token <3 chars
});

// ── end-to-end via buildIndexes ───────────────────────────────────────────
test("buildIndexes: a KV row extracted from real doc content is findable by name, with owner resolved", () => {
  const owner: AtlasNode = { id: "owner-doc", doc_no: "A.1", title: "Keel", type: "Core", depth: 1, parentId: null, order: 0, content: "Keel prime agent.", addressRefs: [] };
  const child: AtlasNode = { id: "child-doc", doc_no: "A.1.1", title: "Mint Cap", type: "Core", depth: 2, parentId: "owner-doc", order: 0, content: "- `maxAmount`: 10,000 USDS", addressRefs: [] };
  const ix = buildIndexes([owner, child], [], [], {});

  const res = atlasParams(ix, { q: "maxamount", limit: 10 }) as { rows: Array<Record<string, unknown>> };
  expect(res.rows.length).toBe(1);
  expect(res.rows[0]).toMatchObject({ uuid: "child-doc", doc_no: "A.1.1", name: "maxamount", value: "10,000 USDS", unit: "USDS", owner: "keel" });
});
