// chain-state.ts — storage, the worker's cadence gate, and the read route.
//
// THE point of this file is the cadence guard: the atlas worker cycle runs every
// ~12 minutes and the multicall sweep must not. So the assertions are about
// whether `fetchSnapshot` was CALLED, not about a predicate's return value — a
// pure isStale() test would pass just as happily with a gate nothing consults.
//
// DB MOCKING — the gate/storage functions take their `sql` tag as a parameter
// (same seam as preview/pr-state.ts's sweepPrStates), so these tests pass a fake
// directly and need no mock.module. Only handleChainState() reaches for the
// shared `sql`, which is why that one gets the module mock.
import { describe, it, expect, beforeEach, mock } from "bun:test";

interface Recorded {
  text: string;
  values: unknown[];
}
let queries: Recorded[] = [];
let row: Record<string, unknown> | null = null;
let readThrows: string | null = null;

// Stands in for Bun's SQL tag: records the query, answers the two shapes
// chain-state.ts issues (the gate's SELECT and the full read).
const fakeSql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
  const text = strings.join("?");
  queries.push({ text, values });
  if (text.includes("FROM chain_state")) {
    if (readThrows) throw new Error(readThrows);
    return row ? [row] : [];
  }
  return [];
};

mock.module("./db.ts", () => ({
  sql: fakeSql,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { readChainState, upsertChainState, maybeRefreshChainState, handleChainState } =
  await import("./chain-state.ts");

const SNAP = { block: "25741379", values: { "0xabc": { wards: "1" } } };
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000);

beforeEach(() => {
  queries = [];
  row = null;
  readThrows = null;
});

describe("maybeRefreshChainState (cadence guard)", () => {
  it("does NOT fetch when the stored snapshot is younger than the refresh interval", async () => {
    row = { block: "25000000", fetched_at: hoursAgo(3) };
    let fetches = 0;
    const res = await maybeRefreshChainState(fakeSql, {
      fetchSnapshot: async () => { fetches++; return SNAP; },
      now: () => NOW,
      refreshSeconds: 86_400,
    });
    expect(fetches).toBe(0); // no RPC, no write — the whole point of the gate
    expect(res).toMatchObject({ refreshed: false, reason: "fresh", block: "25000000" });
    expect(res.ageSeconds).toBe(3 * 3600);
    expect(queries.every((q) => !q.text.includes("INSERT INTO chain_state"))).toBe(true);
  });

  it("fetches and upserts when the stored snapshot is older than the refresh interval", async () => {
    row = { block: "25000000", fetched_at: hoursAgo(30) };
    let fetches = 0;
    const res = await maybeRefreshChainState(fakeSql, {
      fetchSnapshot: async () => { fetches++; return SNAP; },
      now: () => NOW,
      refreshSeconds: 86_400,
    });
    expect(fetches).toBe(1);
    expect(res).toMatchObject({ refreshed: true, reason: "stale", block: "25741379" });
    const insert = queries.find((q) => q.text.includes("INSERT INTO chain_state"))!;
    expect(insert).toBeDefined();
    // Raw JS object + an explicit ::jsonb cast (Bun.sql encodes once; a
    // pre-stringified value would store a JSON *string* scalar).
    expect(insert.values[1]).toEqual(SNAP.values);
    expect(insert.text).toContain("::jsonb");
  });

  it("fetches when there is no row at all, and when the row has no usable timestamp", async () => {
    for (const [label, r, reason] of [
      ["no row", null, "no-row"],
      ["null timestamp", { block: null, fetched_at: null }, "no-timestamp"],
      ["unparseable timestamp", { block: null, fetched_at: "not-a-date" }, "no-timestamp"],
    ] as const) {
      queries = [];
      row = r as Record<string, unknown> | null;
      let fetches = 0;
      const res = await maybeRefreshChainState(fakeSql, {
        fetchSnapshot: async () => { fetches++; return SNAP; },
        now: () => NOW,
      });
      expect(fetches, label).toBe(1); // fail toward spending one RPC batch, never toward never refreshing
      expect(res.reason, label).toBe(reason);
    }
  });

  it("uses config.chainstateRefreshSeconds when the caller passes no interval", async () => {
    const { config } = await import("./config.ts");
    row = { block: "1", fetched_at: new Date(NOW - (config.chainstateRefreshSeconds - 60) * 1000) };
    let fetches = 0;
    await maybeRefreshChainState(fakeSql, { fetchSnapshot: async () => { fetches++; return SNAP; }, now: () => NOW });
    expect(fetches).toBe(0);
  });
});

describe("upsertChainState", () => {
  it("refuses an empty snapshot rather than replacing a good row with nothing", async () => {
    await expect(upsertChainState(fakeSql, { block: "1", values: {} })).rejects.toThrow(/empty chain-state/);
    expect(queries.length).toBe(0);
  });
});

describe("readChainState", () => {
  it("returns the row with an ISO fetchedAt", async () => {
    row = { block: "25741379", values: SNAP.values, fetched_at: hoursAgo(1) };
    expect(await readChainState(fakeSql)).toEqual({
      block: "25741379",
      values: SNAP.values,
      fetchedAt: hoursAgo(1).toISOString(),
    });
  });

  it("parses a double-encoded jsonb value instead of serving a string", async () => {
    row = { block: "1", values: JSON.stringify(SNAP.values), fetched_at: null };
    expect((await readChainState(fakeSql))!.values).toEqual(SNAP.values);
  });

  it("returns null when no snapshot has been stored", async () => {
    expect(await readChainState(fakeSql)).toBeNull();
  });
});

describe("handleChainState", () => {
  it("serves the stored snapshot with a cache header", async () => {
    row = { block: "25741379", values: SNAP.values, fetched_at: hoursAgo(2) };
    const res = await handleChainState();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(await res.json()).toMatchObject({ block: "25741379", values: SNAP.values });
  });

  it("503s with the shared error envelope when no row exists yet (DB-less dev / fresh deploy)", async () => {
    const res = await handleChainState();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });

  it("503s instead of throwing when the DB read fails", async () => {
    readThrows = "connection refused";
    const res = await handleChainState();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});
