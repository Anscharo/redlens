// first-seen.ts: atlas_first_seen bulk "since when" lookup
// (docs/plans/chatbot-readiness-remediation-plan.md, Phase 2.1).
import { describe, it, expect, mock, beforeEach } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity } from "./indexes.ts";

function doc(id: string, doc_no: string): AtlasNode {
  return { id, doc_no, title: doc_no, type: "Core", depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
}
function entity(id: string, slug: string, defining_doc_id: string | null): Entity {
  return { id, slug, name: slug, entity_type: "agent", subtype: null, defining_doc_id, is_active: 1, meta: null };
}

describe("first-seen", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("earliestFirstSeen picks the minimum date across ids, ignoring misses", async () => {
    const { earliestFirstSeen } = await import("./first-seen.ts");
    const map = new Map([
      ["a", { date: "2025-03-01", source: "history" as const }],
      ["b", { date: "2024-11-15", source: "history" as const }],
    ]);
    expect(earliestFirstSeen(map, ["a", "b", "missing"])?.date).toBe("2024-11-15");
    expect(earliestFirstSeen(map, ["missing"])).toBeNull();
  });

  it("firstSeenFor short-circuits on empty input without querying the DB", async () => {
    let called = false;
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => { called = true; return Promise.resolve([]); }, {
        unsafe: () => { called = true; return Promise.resolve([]); },
      }),
    }));
    const { firstSeenFor } = await import("./first-seen.ts");
    const result = await firstSeenFor([]);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("firstSeenFor maps doc_id -> earliest 'added' date, dropping nulls", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () =>
          Promise.resolve([
            { doc_id: "d1", first_added: "2025-01-15" },
            { doc_id: "d2", first_added: null },
          ]),
      }),
    }));
    const { firstSeenFor } = await import("./first-seen.ts");
    const result = await firstSeenFor(["d1", "d2"]);
    expect(result.get("d1")).toEqual({ date: "2025-01-15", source: "history" });
    expect(result.has("d2")).toBe(false);
  });

  it("atlasFirstSeen resolves entity slugs to their defining doc and docs to themselves", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () =>
          Promise.resolve([
            { doc_id: "d1", first_added: "2023-09-02" },
            { doc_id: "d2", first_added: "2025-06-01" },
          ]),
      }),
    }));
    const { atlasFirstSeen } = await import("./first-seen.ts");
    const ix = buildIndexes([doc("d1", "A.1"), doc("d2", "A.2")], [entity("e1", "spark", "d1")], [], {});

    const result = (await atlasFirstSeen(ix, ["spark", "A.2", "missing-thing"])) as { results: Array<Record<string, unknown>> };
    expect(result.results).toEqual([
      { requested: "spark", kind: "entity", label: "spark", resolved: true, first_seen: "2023-09-02", first_seen_source: "history", note: undefined },
      { requested: "A.2", kind: "doc", label: "A.2", resolved: true, first_seen: "2025-06-01", first_seen_source: "history", note: undefined },
      { requested: "missing-thing", kind: "doc", label: "missing-thing", resolved: false, first_seen: null, first_seen_source: null, note: "not found" },
    ]);
  });

  it("atlasFirstSeen reports a distinct note when resolved but never recorded as 'added'", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () => Promise.resolve([]),
      }),
    }));
    const { atlasFirstSeen } = await import("./first-seen.ts");
    const ix = buildIndexes([doc("d1", "A.1")], [], [], {});

    const result = (await atlasFirstSeen(ix, ["A.1"])) as { results: Array<Record<string, unknown>> };
    expect(result.results[0]).toMatchObject({ resolved: true, first_seen: null, note: "no recorded 'added' event in atlas_history" });
  });
});
