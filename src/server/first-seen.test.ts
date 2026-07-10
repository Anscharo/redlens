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
function addedRow(doc_id: string, overrides: Partial<{ committed_at: string | null; pr_number: number | null; era: string | null; commit_sha: string; commit_seq: number | null }> = {}) {
  return {
    doc_id,
    committed_at: "2025-01-15",
    pr_number: null,
    era: null,
    commit_sha: "abc1234",
    commit_seq: 42,
    ...overrides,
  };
}

describe("first-seen", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("earliestFirstSeen picks the minimum date across ids, ignoring misses", async () => {
    const { earliestFirstSeen } = await import("./first-seen.ts");
    const map = new Map([
      ["a", { date: "2025-03-01", source: "pr:100" }],
      ["b", { date: "2024-11-15", source: "mip" }],
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

  it("firstSeenFor drops rows with no committed_at", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () => Promise.resolve([addedRow("d1"), addedRow("d2", { committed_at: null })]),
      }),
    }));
    const { firstSeenFor } = await import("./first-seen.ts");
    const result = await firstSeenFor(["d1", "d2"]);
    expect(result.has("d1")).toBe(true);
    expect(result.has("d2")).toBe(false);
  });

  it("firstSeenFor labels a PR-linked commit as pr:<number>, even if the commit also has an era", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () => Promise.resolve([addedRow("d1", { pr_number: 1234, era: "html" })]),
      }),
    }));
    const { firstSeenFor } = await import("./first-seen.ts");
    const result = await firstSeenFor(["d1"]);
    expect(result.get("d1")).toEqual({ date: "2025-01-15", source: "pr:1234" });
  });

  it("firstSeenFor labels a pre-git era with no PR as mip / genesis-v2 / html-era / severed", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () =>
          Promise.resolve([
            addedRow("mip-doc", { era: "mip" }),
            addedRow("genesis-doc", { era: "genesis" }),
            addedRow("html-doc", { era: "html" }),
            addedRow("severed-doc", { era: "severed" }),
          ]),
      }),
    }));
    const { firstSeenFor } = await import("./first-seen.ts");
    const result = await firstSeenFor(["mip-doc", "genesis-doc", "html-doc", "severed-doc"]);
    expect(result.get("mip-doc")?.source).toBe("mip");
    expect(result.get("genesis-doc")?.source).toBe("genesis-v2");
    expect(result.get("html-doc")?.source).toBe("html-era");
    expect(result.get("severed-doc")?.source).toBe("severed");
  });

  it("firstSeenFor labels a plain git commit (no PR, no era) as commit:<seq>, falling back to the sha", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () =>
          Promise.resolve([addedRow("d1", { commit_seq: 77 }), addedRow("d2", { commit_seq: null, commit_sha: "deadbee" })]),
      }),
    }));
    const { firstSeenFor } = await import("./first-seen.ts");
    const result = await firstSeenFor(["d1", "d2"]);
    expect(result.get("d1")?.source).toBe("commit:77");
    expect(result.get("d2")?.source).toBe("commit:deadbee");
  });

  it("atlasFirstSeen resolves entity slugs to their defining doc and docs to themselves", async () => {
    mock.module("./db.ts", () => ({
      sql: Object.assign(() => Promise.resolve([]), {
        unsafe: () =>
          Promise.resolve([
            addedRow("d1", { committed_at: "2023-09-02", era: "genesis" }),
            addedRow("d2", { committed_at: "2025-06-01", pr_number: 42 }),
          ]),
      }),
    }));
    const { atlasFirstSeen } = await import("./first-seen.ts");
    const ix = buildIndexes([doc("d1", "A.1"), doc("d2", "A.2")], [entity("e1", "spark", "d1")], [], {});

    const result = (await atlasFirstSeen(ix, ["spark", "A.2", "missing-thing"])) as { results: Array<Record<string, unknown>> };
    expect(result.results).toEqual([
      { requested: "spark", kind: "entity", label: "spark", resolved: true, first_seen: "2023-09-02", first_seen_source: "genesis-v2", note: undefined },
      { requested: "A.2", kind: "doc", label: "A.2", resolved: true, first_seen: "2025-06-01", first_seen_source: "pr:42", note: undefined },
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
