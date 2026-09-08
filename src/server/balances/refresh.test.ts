// maybeRefreshBalances — the rolling batch gate the atlas worker runs every tick.
//
// THE point of this file is that a worker cycle (~12 min) must NOT fetch every
// address, and a "nothing is stale" tick must not call fetch at all. Assertions
// are about whether `fetch` was CALLED and with which inputs — a pure
// isStale() test would pass just as happily with a gate nothing consults.
//
// DB MOCKING — the gate takes its `sql` tag as a parameter (same seam as
// chain-state.ts), so these tests pass a fake directly and need no mock.module.
import { describe, it, expect, beforeEach } from "bun:test";
import type { AddressInput, BalanceResult } from "./fetch-balances.ts";

interface Recorded {
  text: string;
  values: unknown[];
}
let queries: Recorded[] = [];
let staleRows: {
  address: string;
  chain: string;
  expected_tokens: string[] | null;
  is_contract: boolean | null;
}[] = [];
// MAX(balances_checked_at) — the hourly ceiling THIS gate reads. POST no
// longer shares it: it selects rows older than an hour rather than
// short-circuiting on an aggregate. null = nothing was ever fetched, so a
// lookup is allowed.
let minCheckedAt: string | null = null;
let maxCheckedAt: string | null = null;

const fakeSql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
  const text = strings.join("?");
  queries.push({ text, values });
  if (text.includes("MIN(balances_checked_at)")) {
    return [{ min: minCheckedAt, max: maxCheckedAt }];
  }
  if (text.includes("ORDER BY balances_checked_at ASC NULLS FIRST")) {
    return staleRows;
  }
  return [];
};

const { maybeRefreshBalances, persistBalanceResults } = await import("./refresh.ts");

const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const ETH = "0xaaa";
const result = (address = ETH, chain = "ethereum"): BalanceResult => ({
  address,
  chain,
  balances: { ETH: { raw: "1", decimals: 18 } },
});

beforeEach(() => {
  queries = [];
  staleRows = [];
  minCheckedAt = null;
  maxCheckedAt = null;
});

describe("maybeRefreshBalances (rolling batch)", () => {
  it("does NOT fetch when no address is older than the refresh interval", async () => {
    staleRows = [];
    let fetches = 0;
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async () => {
        fetches++;
        return [];
      },
      now: () => NOW,
      maxAgeSeconds: 86_400,
      batchSize: 50,
    });
    expect(fetches).toBe(0);
    expect(res).toEqual({ refreshed: false, reason: "fresh", selected: 0, fetched: 0, chain: null });
    expect(queries.every((q) => !q.text.includes("UPDATE atlas_addresses"))).toBe(true);
  });

  it("fetches the selected batch on one chain and persists the results", async () => {
    staleRows = [
      { address: ETH, chain: "ethereum", expected_tokens: ["USDS"], is_contract: false },
      { address: "0xbbb", chain: "ethereum", expected_tokens: null, is_contract: true },
    ];
    let fetched = null as AddressInput[] | null;
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async (inputs) => {
        fetched = inputs;
        return inputs.map((i) => result(i.address, i.chain));
      },
      now: () => NOW,
      maxAgeSeconds: 86_400,
      batchSize: 50,
    });
    expect(fetched).toEqual([
      { address: ETH, chain: "ethereum", expectedTokens: ["USDS"], isContract: false },
      { address: "0xbbb", chain: "ethereum", expectedTokens: [], isContract: true },
    ]);
    expect(res).toEqual({
      refreshed: true,
      reason: "stale",
      selected: 2,
      fetched: 2,
      chain: "ethereum",
    });
    const updates = queries.filter((q) => q.text.includes("UPDATE atlas_addresses"));
    expect(updates).toHaveLength(2);
    expect(updates[0].text).toContain("::jsonb");
    // Cutoff is now - maxAge; batchSize is the LIMIT. Both must reach SQL so a
    // default-only gate can't silently ignore the knobs.
    const select = queries.find((q) => q.text.includes("LIMIT"))!;
    expect(select.text).toContain("WHERE chain = (");
    expect(select.values).toContainEqual(new Date(NOW - 86_400 * 1000));
    expect(select.values).toContain(50);
  });

  it("does not write when the RPC returns nothing for a selected batch", async () => {
    staleRows = [{ address: ETH, chain: "base", expected_tokens: [], is_contract: false }];
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async () => [],
      now: () => NOW,
    });
    expect(res).toEqual({
      refreshed: false,
      reason: "empty",
      selected: 1,
      fetched: 0,
      chain: "base",
    });
    expect(queries.every((q) => !q.text.includes("UPDATE atlas_addresses"))).toBe(true);
  });

  it("does NOT look anything up within an hour of the last reading, however stale rows are", async () => {
    // The ceiling is on lookups, not on staleness: a day-old row still waits
    // for the hour to pass. MAX is also written by POST, so a manual refresh
    // stands the worker down for an hour.
    staleRows = [{ address: ETH, chain: "ethereum", expected_tokens: [], is_contract: false }];
    maxCheckedAt = new Date(NOW - 10 * 60_000).toISOString();
    let fetches = 0;
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async () => {
        fetches++;
        return [];
      },
      now: () => NOW,
    });
    expect(fetches).toBe(0);
    expect(res).toEqual({ refreshed: false, reason: "cooldown", selected: 0, fetched: 0, chain: null });
    // Cheap: the cooldown is decided before the stale-row scan runs at all.
    expect(queries.every((q) => !q.text.includes("LIMIT"))).toBe(true);
  });

  it("cools down off MAX even when MIN is a day old", async () => {
    // A MIN gate would fetch every 12-minute tick once the worker is rolling.
    staleRows = [{ address: ETH, chain: "ethereum", expected_tokens: [], is_contract: false }];
    minCheckedAt = new Date(NOW - 25 * 3_600_000).toISOString();
    maxCheckedAt = new Date(NOW - 10 * 60_000).toISOString();
    let fetches = 0;
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async () => {
        fetches++;
        return [];
      },
      now: () => NOW,
    });
    expect(fetches).toBe(0);
    expect(res.reason).toBe("cooldown");
  });

  it("looks up again once the hour has passed", async () => {
    staleRows = [{ address: ETH, chain: "ethereum", expected_tokens: [], is_contract: false }];
    maxCheckedAt = new Date(NOW - 61 * 60_000).toISOString();
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async (inputs) => inputs.map((i) => result(i.address, i.chain)),
      now: () => NOW,
    });
    expect(res.refreshed).toBe(true);
    expect(res.fetched).toBe(1);
  });

  it("advances the timestamp of a selected address that reported no balances", async () => {
    // The progress invariant: a fetcher answers for every address it was asked
    // about, empty allowed. Those rows MUST still be written (COALESCE keeps
    // the stored balances) — otherwise they are the oldest unchecked rows next
    // cycle too, forever, and nothing else is ever refreshed.
    staleRows = [{ address: ETH, chain: "solana", expected_tokens: [], is_contract: false }];
    const res = await maybeRefreshBalances(fakeSql, {
      fetch: async (inputs) => inputs.map((i) => ({ address: i.address, chain: i.chain, balances: {} })),
      now: () => NOW,
    });
    expect(res.refreshed).toBe(true);
    const updates = queries.filter((q) => q.text.includes("UPDATE atlas_addresses"));
    expect(updates).toHaveLength(1);
    // The write is timestamp-only: balances passes as null, so COALESCE keeps
    // whatever reading is already stored.
    expect(updates[0].values).toContain(null);
    expect(updates[0].values).toContain(new Date(NOW).toISOString());
  });

  it("uses config.balancesRefreshSeconds / balancesRefreshBatch when the caller passes none", async () => {
    const { config } = await import("../config.ts");
    staleRows = [];
    await maybeRefreshBalances(fakeSql, { fetch: async () => [], now: () => NOW });
    const select = queries.find((q) => q.text.includes("LIMIT"))!;
    expect(select.values).toContainEqual(new Date(NOW - config.balancesRefreshSeconds * 1000));
    expect(select.values).toContain(config.balancesRefreshBatch);
  });
});

describe("persistBalanceResults", () => {
  it("is a no-op on an empty result list (no UPDATE)", async () => {
    expect(await persistBalanceResults(fakeSql, [])).toBe(0);
    expect(queries).toHaveLength(0);
  });
});
