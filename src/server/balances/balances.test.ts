// handleBalances unit tests. Mocks ../db.ts (mirrors collections.test.ts's
// convention: a tiny in-memory "atlas_addresses" table driving a tagged-
// template SQL matcher) and viem's createPublicClient (no real RPC calls) so
// the GET-cache / POST-refresh / cooldown-gate / has_code COALESCE /
// corrupted-row self-heal logic all round-trip through the REAL fetchBalances
// → fetchChain path without Postgres or a live chain.
//
// viem is mocked here (not fetch-balances.ts directly) because bun's
// mock.module() replaces a module for the rest of the process, not just this
// file — every *.test.ts under src/server runs in one `bun test` invocation,
// so a mock registered here would otherwise leak into any other file that
// imports fetch-balances.ts. Mocking the npm dependency both files already
// share, and letting the real fetch-balances.ts run against it, avoids that.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as realViem from "viem";
import type { BalancesResponse } from "../../lib/balances.ts";

interface AddrRow {
  address: string;
  chain: string;
  expected_tokens: string[] | null;
  is_contract: boolean | null;
  balances: unknown;
  balances_checked_at: string | null;
  has_code: boolean | null;
}
interface Call {
  address: string;
  functionName: string;
  args: readonly unknown[];
}
interface CallResult {
  status: "success" | "failure";
  result?: unknown;
}

let rows: AddrRow[] = [];
let dbShouldThrow = false;

function execTag(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join("?").replace(/\s+/g, " ").trim();
  if (dbShouldThrow) throw new Error("simulated db failure");

  if (text.includes("SELECT MAX(balances_checked_at) AS max FROM atlas_addresses")) {
    const checked = rows.map((r) => r.balances_checked_at).filter((v): v is string => v != null);
    const max = checked.length ? checked.sort().at(-1)! : null;
    return Promise.resolve([{ max }]);
  }
  if (text.includes("SELECT address, chain, expected_tokens, is_contract FROM atlas_addresses")) {
    return Promise.resolve(
      rows.map((r) => ({ address: r.address, chain: r.chain, expected_tokens: r.expected_tokens, is_contract: r.is_contract })),
    );
  }
  if (text.includes("SELECT address, chain, balances, balances_checked_at, has_code")) {
    return Promise.resolve(
      rows
        .filter((r) => r.balances != null)
        .map((r) => ({ address: r.address, chain: r.chain, balances: r.balances, balances_checked_at: r.balances_checked_at, has_code: r.has_code })),
    );
  }
  if (text.includes("UPDATE atlas_addresses") && text.includes("SET balances")) {
    const [balancesJson, checkedAt, hasCodeParam, address, chain] = values as [string | null, string, boolean | null, string, string];
    const row = rows.find((r) => r.address === address && r.chain === chain);
    if (row) {
      // Mirror both SQL COALESCEs: a null parameter means "this sweep had
      // nothing to say about this column", so the stored value survives.
      row.balances = balancesJson ?? row.balances;
      row.balances_checked_at = checkedAt;
      row.has_code = hasCodeParam ?? row.has_code;
    }
    return Promise.resolve([]);
  }
  throw new Error(`balances.test.ts: unmocked query: ${text}`);
}

function makeExec() {
  return execTag as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
    begin: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
  };
}

const sqlMock = makeExec();
(sqlMock as unknown as { begin: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown> }).begin = async (
  cb: (tx: unknown) => Promise<unknown>,
) => await cb(makeExec());

mock.module("../db.ts", () => ({
  sql: sqlMock,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral: (ids: readonly string[]) => `{${ids.join(",")}}`,
}));

// Every address on "ethereum" resolves to a real RPC URL from the canonical
// chain registry (no env var needed) — createPublicClient is mocked below so
// nothing actually dials out.
let multicallImpl: (contracts: Call[]) => Promise<CallResult[]> = async (contracts) =>
  contracts.map(() => ({ status: "success", result: 1000000000000000000n }));
let getCodeImpl: (address: string) => Promise<string | undefined> = async () => "0x";

mock.module("viem", () => ({
  ...realViem,
  createPublicClient: () => ({
    multicall: ({ contracts }: { contracts: Call[] }) => multicallImpl(contracts),
    getCode: ({ address }: { address: string }) => getCodeImpl(address),
  }),
}));

const { handleBalances } = await import("./balances.ts");

function req(method: "GET" | "POST"): Request {
  return new Request("http://localhost/api/balances", { method });
}

beforeEach(() => {
  rows = [];
  dbShouldThrow = false;
  multicallImpl = async (contracts) => contracts.map(() => ({ status: "success", result: 1000000000000000000n }));
  getCodeImpl = async () => "0x";
});
afterEach(() => {
  mock.restore();
});

describe("handleBalances GET", () => {
  it("returns an empty cache when nothing has balances yet", async () => {
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: null, balances_checked_at: null, has_code: null }];
    const res = await handleBalances(req("GET"));
    const body = (await res.json()) as BalancesResponse;
    expect(body).toEqual({ lastCheckedAt: null, nextRefreshAt: null, refreshed: false, addresses: {} });
  });

  it("keys cached rows by address|chain and passes through hasCode", async () => {
    rows = [
      {
        address: "0xAAA",
        chain: "ethereum",
        expected_tokens: [],
        is_contract: false,
        balances: { ETH: { raw: "1", decimals: 18 } },
        balances_checked_at: "2026-08-05T09:00:00.000Z",
        has_code: true,
      },
    ];
    const res = await handleBalances(req("GET"));
    const body = (await res.json()) as BalancesResponse;
    expect(body.addresses["0xaaa|ethereum"]).toEqual({
      chain: "ethereum",
      checkedAt: "2026-08-05T09:00:00.000Z",
      hasCode: true,
      balances: { ETH: { raw: "1", decimals: 18 } },
    });
    expect(body.lastCheckedAt).toBe("2026-08-05T09:00:00.000Z");
  });

  it("self-heals a row whose balances were double-JSON-encoded (the pre-fix bug)", async () => {
    rows = [
      {
        address: "0xbbb",
        chain: "ethereum",
        expected_tokens: [],
        is_contract: false,
        balances: JSON.stringify({ ETH: { raw: "2", decimals: 18 } }), // stored as a string, not jsonb object
        balances_checked_at: "2026-08-05T09:00:00.000Z",
        has_code: null,
      },
    ];
    const res = await handleBalances(req("GET"));
    const body = (await res.json()) as BalancesResponse;
    expect(body.addresses["0xbbb|ethereum"].balances).toEqual({ ETH: { raw: "2", decimals: 18 } });
  });

  it("drops an unparseable corrupted row to an empty balance map instead of crashing", async () => {
    rows = [
      { address: "0xccc", chain: "ethereum", expected_tokens: [], is_contract: false, balances: "not json", balances_checked_at: "2026-08-05T09:00:00.000Z", has_code: null },
    ];
    const res = await handleBalances(req("GET"));
    const body = (await res.json()) as BalancesResponse;
    expect(body.addresses["0xccc|ethereum"].balances).toEqual({});
  });
});

describe("handleBalances POST", () => {
  it("skips the refresh and returns the cache unchanged inside the hourly cooldown", async () => {
    const recent = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: { ETH: { raw: "1", decimals: 18 } }, balances_checked_at: recent, has_code: null }];
    let called = false;
    multicallImpl = async (contracts) => { called = true; return contracts.map(() => ({ status: "success", result: 1n })); };

    const res = await handleBalances(req("POST"));
    const body = (await res.json()) as BalancesResponse;
    expect(called).toBe(false);
    expect(body.refreshed).toBe(false);
  });

  it("fetches and writes fresh balances outside the cooldown, COALESCE-ing has_code", async () => {
    rows = [
      { address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: null, balances_checked_at: null, has_code: null },
      { address: "0xbbb", chain: "ethereum", expected_tokens: [], is_contract: true, balances: null, balances_checked_at: null, has_code: null },
    ];
    // 0xaaa is unverified (isContract:false) → its getCode is checked and comes
    // back empty, confirming a real EOA. 0xbbb is verified → getCode is never
    // called for it (planCodeChecks skips verified contracts).
    getCodeImpl = async (address) => (address === "0xaaa" ? "0x" : "0x1234");

    const res = await handleBalances(req("POST"));
    const body = (await res.json()) as BalancesResponse;
    expect(body.refreshed).toBe(true);
    expect(body.addresses["0xaaa|ethereum"].balances.ETH).toEqual({ raw: "1000000000000000000", decimals: 18 });
    expect(body.addresses["0xaaa|ethereum"].hasCode).toBe(false);
    expect(body.addresses["0xbbb|ethereum"].hasCode).toBeNull(); // untouched (was already null) — not overwritten
  });

  it("keeps cached balances when the multicall fails but the code check still answers", async () => {
    // A failed multicall reports by omission, so an empty balance map is
    // indistinguishable from "holds nothing" — it must not clobber the cache.
    // The eth_getCode answer is still real, so the sweep did refresh something.
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: { ETH: { raw: "1", decimals: 18 } }, balances_checked_at: null, has_code: null }];
    multicallImpl = async (contracts) => contracts.map(() => ({ status: "failure" }));
    getCodeImpl = async () => "0x60806040"; // it is a contract

    const res = await handleBalances(req("POST"));
    const body = (await res.json()) as BalancesResponse;
    expect(body.refreshed).toBe(true);
    expect(rows[0].has_code).toBe(true);
    expect(rows[0].balances).toEqual({ ETH: { raw: "1", decimals: 18 } }); // NOT overwritten with {}
    getCodeImpl = async () => "0x";
  });

  it("leaves the cache unchanged and refreshed:false when the sweep learns nothing at all", async () => {
    // Already known to be a contract, so planCodeChecks skips it — with the
    // multicall failing too, there is genuinely nothing to write.
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: true, balances: { ETH: { raw: "1", decimals: 18 } }, balances_checked_at: null, has_code: null }];
    multicallImpl = async (contracts) => contracts.map(() => ({ status: "failure" }));

    const res = await handleBalances(req("POST"));
    const body = (await res.json()) as BalancesResponse;
    expect(body.refreshed).toBe(false);
    expect(rows[0].balances_checked_at).toBeNull();
  });

  it("a chain-level multicall failure is caught internally and doesn't fail the refresh", async () => {
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: null, balances_checked_at: null, has_code: null }];
    multicallImpl = () => Promise.reject(new Error("rpc down"));

    const res = await handleBalances(req("POST"));
    const body = (await res.json()) as BalancesResponse;
    expect(res.status).toBe(200);
    expect(body.refreshed).toBe(false); // fetchBalances caught it, produced zero results
  });

  it("coalesces concurrent POSTs onto one in-flight refresh", async () => {
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: null, balances_checked_at: null, has_code: null }];
    let calls = 0;
    multicallImpl = async (contracts) => { calls++; return contracts.map(() => ({ status: "success", result: 1n })); };

    // Both calls issued before either awaits — the second must see inFlight
    // already set (synchronously, before doRefresh's first await) and skip
    // launching its own sweep.
    const [r1, r2] = await Promise.all([handleBalances(req("POST")), handleBalances(req("POST"))]);
    expect(calls).toBe(1);
    expect(((await r1.json()) as BalancesResponse).refreshed).toBe(true);
    expect(((await r2.json()) as BalancesResponse).refreshed).toBe(true);
  });
});

describe("handleBalances misc", () => {
  it("405s any other method", async () => {
    const res = await handleBalances(req("DELETE" as "GET"));
    expect(res.status).toBe(405);
  });

  it("503s and doesn't throw when the DB errors", async () => {
    rows = [{ address: "0xaaa", chain: "ethereum", expected_tokens: [], is_contract: false, balances: null, balances_checked_at: new Date(Date.now() - 3_700_000).toISOString(), has_code: null }];
    dbShouldThrow = true;
    const res = await handleBalances(req("POST"));
    expect(res.status).toBe(503);
  });
});
