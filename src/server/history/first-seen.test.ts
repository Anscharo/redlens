// first-seen.ts: atlas_first_seen bulk "since when" lookup
// (docs/plans/chatbot-readiness-remediation-plan.md, Phase 2.1).
//
// Run under `bun test` (NOT vitest) — imports Bun SQL transitively via ../db.ts.
//
// DB MOCKING SHAPE — see history.test.ts's header for the full write-up. The
// short version: bun's `mock.module` patches the module registry for the REST
// OF THE PROCESS, and `mock.restore()` does NOT undo it. This file used to call
// `mock.module("../db.ts", …)` from inside eight `it()` bodies, each supplying
// ONLY `sql` — so the moment this file had run, db.ts had permanently lost
// `toVectorLiteral`/`dbTarget`/`waitForDb`, and the next file to import one of
// those died at link time ("Export named 'toVectorLiteral' not found in module
// …/db.ts"). That is a module-link error, not an assertion, so it takes out a
// whole file. `bun test` walks files in readdir order (and reorders explicit
// CLI args), so which file got hit varied by machine and by checkout.
//
// There is now exactly ONE module-scope registration, spreading the eagerly
// snapshotted real namespace so no export is ever dropped, whose `sql`
// dispatches to a swappable `sqlImpl` that each test arms and beforeEach/
// afterEach disarms. Disarmed it delegates to the real client, so the
// registration is a behavioural no-op for every file scheduled after this one.
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { buildIndexes, type AtlasNode, type Entity } from "../retrieval/indexes.ts";

// EAGER snapshot into plain consts: a module namespace object is LIVE, so
// reading `ns.sql` after the mock lands would resolve to our own dispatcher and
// recurse until the stack blows.
const baseNs = await import("../db.ts");
const baseExports: Record<string, unknown> = { ...baseNs };
const baseSql = baseNs.sql as unknown as Record<PropertyKey, unknown> | undefined;

type SqlImpl = (...args: unknown[]) => unknown;
let sqlImpl: SqlImpl | null = null;

// A real function, not `new Proxy(baseSql, {apply})`: migrate.test.ts replaces
// `sql` with a non-callable object, and a Proxy over a non-callable target is
// itself not callable, which would kill the tagged-template form used here.
function sqlCall(...args: unknown[]): unknown {
  if (sqlImpl) return sqlImpl(...args);
  if (typeof baseSql !== "function") {
    throw new Error("db.ts `sql` is not callable — an earlier test file replaced it with a non-callable stub");
  }
  return (baseSql as SqlImpl)(...args);
}

// Non-call members (`.unsafe` for retrieval/*, `.reserve`/`.begin` for
// migrate.ts) forward to the snapshot so later files keep whatever they had.
const FN_OWN = new Set<PropertyKey>(["length", "name", "prototype", "constructor", "call", "apply", "bind"]);
const sqlDispatch = new Proxy(sqlCall, {
  get(target, prop, receiver) {
    if (baseSql && !FN_OWN.has(prop)) {
      const v = baseSql[prop];
      if (v !== undefined) return typeof v === "function" ? (v as SqlImpl).bind(baseSql) : v;
    }
    return Reflect.get(target, prop, receiver);
  },
});

mock.module("../db.ts", () => ({ ...baseExports, sql: sqlDispatch }));

const { firstSeenFor, atlasFirstSeen } = await import("./first-seen.ts");

function doc(id: string, doc_no: string, title = doc_no): AtlasNode {
  return { id, doc_no, title, type: "Core", depth: 1, parentId: null, content: "", order: 0, addressRefs: [] };
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

// Arms the dispatcher so firstSeenFor's tagged-template query resolves to
// `rows`. `sql(ids)` (the array-fragment helper used inline in the template)
// is also routed through this same function — its return value is just an
// opaque substitution the stubbed tag call ignores, per the established
// convention in history.test.ts. atlasFirstSeen's follow-up seam query lands
// here too, which is why the "no 'added' event" cases arm an empty array.
function mockHistoryRows(rows: ReturnType<typeof addedRow>[]) {
  sqlImpl = () => Promise.resolve(rows);
}

describe("first-seen", () => {
  // Disarm on both edges so no case leaks its impl into a sibling — or, once
  // this file finishes, into another test file.
  beforeEach(() => {
    sqlImpl = null;
  });
  afterEach(() => {
    sqlImpl = null;
  });

  it("firstSeenFor short-circuits on empty input without querying the DB", async () => {
    let called = false;
    sqlImpl = () => {
      called = true;
      return Promise.resolve([]);
    };
    const result = await firstSeenFor([]);
    expect(result.size).toBe(0);
    expect(called).toBe(false);
  });

  it("firstSeenFor keeps a row with a null committed_at (severed era) rather than dropping it", async () => {
    mockHistoryRows([addedRow("d1"), addedRow("d2", { committed_at: null, era: "severed" })]);
    const result = await firstSeenFor(["d1", "d2"]);
    expect(result.get("d1")).toEqual({ date: "2025-01-15", source: "commit:abc1234" });
    expect(result.get("d2")).toEqual({ date: null, source: "severed" });
  });

  it("firstSeenFor labels a PR-linked commit as pr:<number>, even if the commit also has an era", async () => {
    mockHistoryRows([addedRow("d1", { pr_number: 1234, era: "html" })]);
    const result = await firstSeenFor(["d1"]);
    expect(result.get("d1")).toEqual({ date: "2025-01-15", source: "pr:1234" });
  });

  it("firstSeenFor labels a pre-git era with no PR as mip / genesis-v2 / html-era / severed", async () => {
    mockHistoryRows([
      addedRow("mip-doc", { era: "mip" }),
      addedRow("genesis-doc", { era: "genesis" }),
      addedRow("html-doc", { era: "html" }),
      addedRow("severed-doc", { era: "severed" }),
    ]);
    const result = await firstSeenFor(["mip-doc", "genesis-doc", "html-doc", "severed-doc"]);
    expect(result.get("mip-doc")?.source).toBe("mip");
    expect(result.get("genesis-doc")?.source).toBe("genesis-v2");
    expect(result.get("html-doc")?.source).toBe("html-era");
    expect(result.get("severed-doc")?.source).toBe("severed");
  });

  it("firstSeenFor labels a plain git commit (no PR, no era) as commit:<short sha>", async () => {
    mockHistoryRows([addedRow("d1", { commit_sha: "deadbee" })]);
    const result = await firstSeenFor(["d1"]);
    expect(result.get("d1")?.source).toBe("commit:deadbee");
  });

  it("atlasFirstSeen resolves entity slugs to their defining doc and docs to themselves", async () => {
    mockHistoryRows([
      addedRow("d1", { committed_at: "2023-09-02", era: "genesis" }),
      addedRow("d2", { committed_at: "2025-06-01", pr_number: 42 }),
    ]);
    const ix = buildIndexes([doc("d1", "A.1"), doc("d2", "A.2")], [entity("e1", "spark", "d1")], [], {});

    const result = (await atlasFirstSeen(ix, ["spark", "A.2", "missing-thing"])) as { results: Array<Record<string, unknown>> };
    expect(result.results).toEqual([
      { requested: "spark", kind: "entity", label: "spark", resolved: true, first_seen: "2023-09-02", first_seen_source: "genesis-v2", note: undefined },
      { requested: "A.2", kind: "doc", label: "A.2", resolved: true, first_seen: "2025-06-01", first_seen_source: "pr:42", note: undefined },
      { requested: "missing-thing", kind: "doc", label: "missing-thing", resolved: false, first_seen: null, first_seen_source: null, note: "not found" },
    ]);
  });

  it("atlasFirstSeen reports a distinct note when resolved but never recorded as 'added'", async () => {
    mockHistoryRows([]);
    const ix = buildIndexes([doc("d1", "A.1")], [], [], {});

    const result = (await atlasFirstSeen(ix, ["A.1"])) as { results: Array<Record<string, unknown>> };
    expect(result.results[0]).toMatchObject({ resolved: true, first_seen: null, note: "no recorded 'added' event in atlas_history" });
  });

  it("atlasFirstSeen distinguishes 'entity found, no defining doc' from 'not found'", async () => {
    mockHistoryRows([]);
    // sky-core-style entity: real, resolvable, but bootstrapped with no defining doc
    // (scripts/lib/graph-entities.mjs) — must not be reported the same as an unknown slug.
    const ix = buildIndexes([], [entity("e1", "sky-core", null)], [], {});

    const result = (await atlasFirstSeen(ix, ["sky-core", "definitely-not-a-slug"])) as { results: Array<Record<string, unknown>> };
    expect(result.results[0]).toMatchObject({
      requested: "sky-core", resolved: true, first_seen: null, note: "entity has no defining doc — first_seen cannot be derived",
    });
    expect(result.results[1]).toMatchObject({ requested: "definitely-not-a-slug", resolved: false, note: "not found" });
  });

  it("atlasFirstSeen reports a severed-era record as recorded-but-undated, not missing", async () => {
    mockHistoryRows([addedRow("d1", { committed_at: null, era: "severed" })]);
    const ix = buildIndexes([doc("d1", "A.1")], [], [], {});

    const result = (await atlasFirstSeen(ix, ["A.1"])) as { results: Array<Record<string, unknown>> };
    expect(result.results[0]).toMatchObject({
      resolved: true,
      first_seen: null,
      first_seen_source: "severed",
      note: "recorded as 'added' but the exact date is unknown (severed era)",
    });
  });

  it("atlasFirstSeen XOR: ids and class together, or neither, is an error", async () => {
    mockHistoryRows([]);
    const ix = buildIndexes([doc("d1", "A.1", "Rate Limit")], [], [], {});
    expect((await atlasFirstSeen(ix, { ids: ["d1"], title: "Rate Limit" }) as { error?: string }).error).toBeDefined();
    expect((await atlasFirstSeen(ix, {}) as { error?: string }).error).toBeDefined();
  });

  it("atlasFirstSeen class mode reduces to oldest ties without a 50 cap on the class", async () => {
    mockHistoryRows([
      addedRow("old", { committed_at: "2025-11-07", pr_number: 10, pr_title: "Birth" }),
      addedRow("new", { committed_at: "2026-07-10" }),
      addedRow("tie", { committed_at: "2025-11-07", pr_number: 10, pr_title: "Birth" }),
    ]);
    const ix = buildIndexes(
      [doc("old", "A.1", "Rate Limit"), doc("new", "A.2", "Rate Limit"), doc("tie", "A.3", "Rate Limit"), doc("other", "B.1", "Other")],
      [],
      [],
      {},
    );
    const result = (await atlasFirstSeen(ix, { title: "Rate Limit" })) as {
      class_total: number;
      class_with_history: number;
      event: string;
      oldest: Array<{ uuid: string; date: string }>;
      results?: unknown;
    };
    expect(result.results).toBeUndefined();
    expect(result.event).toBe("added");
    expect(result.class_total).toBe(3);
    expect(result.class_with_history).toBe(3);
    expect(result.oldest.map((o) => o.uuid).sort()).toEqual(["old", "tie"]);
    expect(result.oldest.every((o) => o.date === "2025-11-07")).toBe(true);
  });

  it("atlasFirstSeen class mode event=modified queries content rows", async () => {
    const seen: string[] = [];
    sqlImpl = (...args: unknown[]) => {
      seen.push(JSON.stringify(args));
      return Promise.resolve([addedRow("old", { committed_at: "2026-04-09" })]);
    };
    const ix = buildIndexes([doc("old", "A.1", "Rate Limit")], [], [], {});
    const result = (await atlasFirstSeen(ix, { title: "Rate Limit", event: "modified" })) as {
      event: string;
      oldest: Array<{ uuid: string; date: string }>;
    };
    expect(result.event).toBe("modified");
    expect(result.oldest[0]).toMatchObject({ uuid: "old", date: "2026-04-09" });
    expect(seen.some((s) => s.includes("content"))).toBe(true);
  });
});

const INCIDENT_UUID = "8414b48b-932e-430e-a236-727807fd73ba";

describe("first-seen class mode against a populated atlas_history", () => {
  it("Rate Limit modified is older than 2026-07-10 and includes the incident UUID", async () => {
    if (!process.env.DATABASE_URL) return;
    sqlImpl = null;
    let ix: ReturnType<typeof buildIndexes>;
    try {
      const { loadIndexes } = await import("../retrieval/indexes.ts");
      ix = loadIndexes();
    } catch {
      return;
    }
    const result = (await atlasFirstSeen(ix, { title: "Rate Limit", event: "modified" })) as {
      error?: string;
      class_total?: number;
      class_with_history?: number;
      oldest?: Array<{ uuid: string; date: string }>;
    };
    if (result.error || !result.class_with_history) return;
    expect(result.oldest?.length).toBeGreaterThan(0);
    const min = result.oldest![0]!.date;
    expect(min < "2026-07-10").toBe(true);
    expect(result.oldest!.some((o) => o.uuid === INCIDENT_UUID)).toBe(true);
  });
});
