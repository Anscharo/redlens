// The pau_state gate and reads. The gate's job is to spend RPC only when a
// snapshot is due (or missing) and to drop snapshots of deployments the
// registry no longer lists; the reads tolerate a double-encoded jsonb value.
import { describe, expect, it, mock } from "bun:test";
import type { PauRegistry } from "../../lib/pauRegistry.ts";
import { fromUuidArray, toUuidArrayLiteral } from "../pg-array.ts";

// Only handlePau() reaches for the module-level sql; everything else takes a tag.
let served: unknown[] | Error = [];
mock.module("../db.ts", () => ({
  sql: async () => {
    if (served instanceof Error) throw served;
    return served;
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed (see pg-array.ts).
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { eventsOf, handlePau, maybeRefreshPauState, readPauState } = await import("./store.ts");

const NOW = Date.UTC(2026, 9, 7, 12);
const reg = { shared: [], ignored: [], deployments: [{ prime: "p", primeName: "Spark", chain: "ethereum", kind: "monolithic", members: [] }] } as unknown as PauRegistry;

function fakeDb(stored: { deployment: string; fetched_at: Date }[]) {
  const writes: string[] = [];
  const db = async (strings: TemplateStringsArray, ...v: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT deployment, fetched_at")) return stored;
    if (text.includes("DELETE FROM pau_state")) writes.push(`delete ${v[0]}`);
    if (text.includes("INSERT INTO pau_state")) writes.push(`upsert ${v[0]}`);
    return [];
  };
  return { db, writes };
}

const read = async () => [];

describe("maybeRefreshPauState", () => {
  it("does nothing while every snapshot is younger than the interval", async () => {
    const { db, writes } = fakeDb([{ deployment: "p:ethereum:monolithic", fetched_at: new Date(NOW - 60_000) }]);
    expect(await maybeRefreshPauState(db, reg, read, { refreshSeconds: 3600, now: NOW })).toEqual({ refreshed: 0, removed: 0, reason: "fresh" });
    expect(writes).toEqual([]);
  });
  it("rebuilds when a snapshot is missing or old, and drops unlisted deployments", async () => {
    const { db, writes } = fakeDb([{ deployment: "gone:base:diamond", fetched_at: new Date(NOW) }]);
    expect(await maybeRefreshPauState(db, reg, read, { refreshSeconds: 3600, now: NOW })).toEqual({ refreshed: 1, removed: 1, reason: "due" });
    expect(writes).toEqual(["delete gone:base:diamond", "upsert p:ethereum:monolithic"]);
    const old = fakeDb([{ deployment: "p:ethereum:monolithic", fetched_at: new Date(NOW - 3_600_000) }]);
    expect((await maybeRefreshPauState(old.db, reg, read, { refreshSeconds: 3600, now: NOW })).reason).toBe("due");
  });
});

describe("reads", () => {
  it("normalizes event rows: BIGINT strings, Date times, string-encoded args", async () => {
    const db = async () => [{ contract: "0xc", event: "X", args: '{"a":1}', block: "42", block_time: new Date(NOW), tx_hash: "0xt" }];
    expect(await eventsOf(db, "ethereum", "0xc")).toEqual([{ contract: "0xc", event: "X", args: { a: 1 }, block: 42, block_time: new Date(NOW).toISOString(), tx_hash: "0xt" }]);
  });
  it("returns snapshots ordered by prime, chain and kind with their fetch time", async () => {
    const snap = (primeName: string, chain: string) => ({ primeName, chain, kind: "monolithic", contracts: [] });
    const db = async () => [
      { state: snap("Spark", "base"), fetched_at: new Date(NOW) },
      { state: JSON.stringify(snap("Grove", "ethereum")), fetched_at: new Date(NOW) },
    ];
    const out = await readPauState(db);
    expect(out.map((s) => `${s.primeName}:${s.chain}`)).toEqual(["Grove:ethereum", "Spark:base"]);
    expect(out[0].fetchedAt).toBe(new Date(NOW).toISOString());
  });
});

describe("handlePau", () => {
  it("serves every snapshot with a cache header, an empty list before the first run", async () => {
    served = [];
    const empty = await handlePau();
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await empty.json()).toEqual({ deployments: [] });
    served = [{ state: { primeName: "Spark", chain: "base", kind: "monolithic", contracts: [] }, fetched_at: new Date(NOW) }];
    expect(((await (await handlePau()).json()) as { deployments: unknown[] }).deployments).toHaveLength(1);
  });
  it("503s instead of throwing when the read fails", async () => {
    served = new Error("connection refused");
    const res = await handlePau();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});
