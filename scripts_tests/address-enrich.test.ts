// Unit coverage for the Etherscan/chainlog enrichment helpers. fs is mocked
// to an in-memory store so the read-through cache never hits disk; fetch is
// stubbed per-test.
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirror address-enrich.mjs's cachePath() so a seeded cache key matches the key
// the module reads, regardless of where the repo is checked out — local and CI
// absolute paths differ (/home/user/... vs /home/runner/work/...).
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const cacheKey = (chainid: number, addr: string) =>
  path.join(REPO_ROOT, ".cache/etherscan", String(chainid), `${addr}.json`);

const store = new Map<string, string>();
vi.mock("node:fs/promises", () => {
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
  return {
    default: {
      readFile: vi.fn(async (p: string) => {
        if (store.has(p)) return store.get(p)!;
        throw enoent(p);
      }),
      writeFile: vi.fn(async (p: string, data: string) => { store.set(p, data); }),
      mkdir: vi.fn(async () => undefined),
    },
  };
});

// @ts-expect-error — runtime-only .mjs import.
import { fetchChainlog, enrichAddresses, fetchImplABIs } from "../scripts/lib/address-enrich.mjs";

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const verified = (over: Record<string, unknown> = {}) => okJson({
  status: "1",
  result: [{ ContractName: "Foo", ABI: "[]", Proxy: "0", Implementation: "", SourceCode: "x", ...over }],
});

beforeEach(() => {
  store.clear();
  vi.unstubAllGlobals();
  delete process.env.REFRESH_PROXY_CACHE;
  // Don't wait the real 1 req/s Etherscan throttle during unit tests.
  process.env.ETHERSCAN_THROTTLE_MS = "0";
});

describe("fetchChainlog", () => {
  it("inverts the chainlog name→addr map into addr→name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ MCD_VAT: "0xAbC0000000000000000000000000000000000001" })));
    expect(await fetchChainlog()).toEqual({ "0xabc0000000000000000000000000000000000001": "MCD_VAT" });
  });
  it("skips non-address entries in the chainlog payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ CHANGELOG_VERSION: "1.20.0", MCD_VAT: "0xAbC0000000000000000000000000000000000001" })));
    expect(await fetchChainlog()).toEqual({ "0xabc0000000000000000000000000000000000001": "MCD_VAT" });
  });
  it("returns null (not {}) when the fetch fails so callers can refuse to overwrite", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    expect(await fetchChainlog()).toBeNull();
  });
});

describe("enrichAddresses", () => {
  it("emits a minimal entry for solana with no network call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await enrichAddresses({ sol1: { chain: "solana" } }, {}, "KEY");
    expect(out.sol1).toEqual({ chain: "solana", isContract: false, isProxy: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches + caches a verified EVM contract and labels it via chainlog", async () => {
    const addr = "0x1111111111111111111111111111111111111111";
    vi.stubGlobal("fetch", vi.fn(async () => verified()));
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, { [addr]: "FOO" }, "KEY");
    expect(out[addr]).toMatchObject({ chain: "ethereum", chainlogId: "FOO", etherscanName: "Foo", isContract: true, isProxy: false });
    // second call hits the in-memory cache (no fetch)
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not cache a transient rate-limit NOTOK as an empty entry", async () => {
    const addr = "0x2222222222222222222222222222222222222222";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ status: "0", message: "NOTOK", result: "Max rate limit reached" })));
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ chain: "ethereum", isContract: false });
    expect([...store.keys()].some((k) => k.includes(addr))).toBe(false);
  });

  it("re-verifies a cached proxy only when REFRESH_PROXY_CACHE is set, rewriting on impl change", async () => {
    const addr = "0x3333333333333333333333333333333333333333";
    const oldImpl = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const newImpl = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    // 1) populate the cache with an old proxy entry via the module's own writeCache
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: oldImpl })));
    let out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ isProxy: true, implementation: oldImpl });

    // 2) without the flag, a second run must NOT refetch (stays old)
    const noFetch = vi.fn();
    vi.stubGlobal("fetch", noFetch);
    out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(noFetch).not.toHaveBeenCalled();
    expect(out[addr].implementation).toBe(oldImpl);

    // 3) with the flag + a new impl, it re-verifies and rewrites
    process.env.REFRESH_PROXY_CACHE = "1";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: newImpl })));
    out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr].implementation).toBe(newImpl);

    // 4) with the flag but unchanged impl, no rewrite churn (still succeeds)
    const sameFetch = vi.fn(async () => verified({ Proxy: "1", Implementation: newImpl }));
    vi.stubGlobal("fetch", sameFetch);
    out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(sameFetch).toHaveBeenCalled();
    expect(out[addr].implementation).toBe(newImpl);
  });
});

describe("fetchImplABIs", () => {
  it("fetches implementation ABIs for proxy contracts not yet cached", async () => {
    const impl = "0xcccccccccccccccccccccccccccccccccccccccc";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ ContractName: "Impl" })));
    const out = { "0xproxyaddr": { isProxy: true, implementation: impl } };
    await fetchImplABIs(out, "KEY");
    expect([...store.keys()].some((k) => k.endsWith(`${impl}.json`))).toBe(true);
  });

  it("no-ops when there are no proxy contracts to fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await fetchImplABIs({ "0xnotaproxy": { isProxy: false } }, "KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips an implementation address already cached, and warns (not throws) on fetch failure", async () => {
    const cachedImpl = "0xdddddddddddddddddddddddddddddddddddddddd";
    const failingImpl = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ ContractName: "" })));
    await fetchImplABIs({ a: { isProxy: true, implementation: cachedImpl } }, "KEY");

    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await fetchImplABIs(
      { a: { isProxy: true, implementation: cachedImpl }, b: { isProxy: true, implementation: failingImpl } },
      "KEY",
    );
    // cachedImpl is skipped (no fetch for it); failingImpl is fetched and fails.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("fetchEtherscan edge responses (via enrichAddresses)", () => {
  it("treats a non-rate-limit NOTOK as unverified and caches an empty entry", async () => {
    const addr = "0x4444444444444444444444444444444444444444";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ status: "0", message: "NOTOK", result: "Invalid API Key" })));
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ isContract: false, isProxy: false });
    expect([...store.keys()].some((k) => k.includes(addr))).toBe(true);
  });

  it("treats an empty result array as unverified", async () => {
    const addr = "0x5555555555555555555555555555555555555555";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ status: "1", result: [] })));
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ isContract: false, isProxy: false });
  });

  it("falls back to empty strings when result fields are missing", async () => {
    const addr = "0x6666666666666666666666666666666666666666";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ status: "1", result: [{}] })));
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ isContract: false, isProxy: false });
  });

  it("treats a non-array, non-string result as unverified", async () => {
    const addr = "0x6767676767676767676767676767676767676767";
    vi.stubGlobal("fetch", vi.fn(async () => okJson({ status: "1", result: { unexpected: true } })));
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ isContract: false, isProxy: false });
  });

  it("records an error (via HTTP failure) without caching, on a genuine Etherscan outage", async () => {
    const addr = "0x7777777777777777777777777777777777777777";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr]).toMatchObject({ isContract: false, isProxy: false });
    expect([...store.keys()].some((k) => k.includes(addr))).toBe(false);
    warnSpy.mockRestore();
  });
});

describe("enrichAddresses additional branches", () => {
  it("defaults chainid to 1 (mainnet) for a chain absent from CHAIN_ID", async () => {
    const addr = "0x8888888888888888888888888888888888888888";
    vi.stubGlobal("fetch", vi.fn(async () => verified()));
    const out = await enrichAddresses({ [addr]: { chain: "totallyUnknownChain" } }, { [addr]: "FOO" }, "KEY");
    // chainid falls back to 1 (mainnet), so chainlog lookup applies.
    expect(out[addr]).toMatchObject({ chainlogId: "FOO" });
    expect([...store.keys()].some((k) => k.includes("/1/"))).toBe(true);
  });

  it("never applies a chainlog label on a non-mainnet chain, even if the address collides", async () => {
    const addr = "0x9999999999999999999999999999999999999999";
    vi.stubGlobal("fetch", vi.fn(async () => verified()));
    const out = await enrichAddresses({ [addr]: { chain: "base" } }, { [addr]: "FOO" }, "KEY");
    expect(out[addr].chainlogId).toBeUndefined();
  });

  it("propagates a non-ENOENT cache read error instead of silently treating it as a miss", async () => {
    const addr = "0xaaaa111111111111111111111111111111aaaa1";
    const chainid = 1;
    const p = cacheKey(chainid, addr);
    store.set(p, "{not valid json");
    await expect(enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY")).rejects.toThrow();
  });

  it("logs progress every 25 cache misses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => verified()));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const atlas: Record<string, { chain: string }> = {};
    for (let i = 0; i < 25; i++) {
      atlas[`0x${String(i).padStart(40, "0")}`] = { chain: "ethereum" };
    }
    await enrichAddresses(atlas, {}, "KEY");
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("cache misses"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs the ∅ fallback when a proxy's implementation is empty before or after re-verify", async () => {
    const addr = "0xbbbb222222222222222222222222222222bbbb2";
    // populate cache with a proxy that has no implementation address yet
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: "" })));
    await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");

    process.env.REFRESH_PROXY_CACHE = "1";
    const newImpl = "0xffffffffffffffffffffffffffffffffffffffff";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: newImpl })));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr].implementation).toBe(newImpl);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes("∅"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs the ∅ fallback for the fresh side when a proxy's implementation is removed on re-verify", async () => {
    const addr = "0xeeee444444444444444444444444444444eeee4";
    const oldImpl = "0xffffffffffffffffffffffffffffffffffffff11";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: oldImpl })));
    await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");

    process.env.REFRESH_PROXY_CACHE = "1";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: "" })));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr].implementation).toBeUndefined();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes(`${oldImpl} → ∅`))).toBe(true);
    logSpy.mockRestore();
  });

  it("warns and keeps the cached proxy entry when re-verify itself fails", async () => {
    const addr = "0xcccc333333333333333333333333333333cccc3";
    const oldImpl = "0xdddddddddddddddddddddddddddddddddddddddd";
    vi.stubGlobal("fetch", vi.fn(async () => verified({ Proxy: "1", Implementation: oldImpl })));
    await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");

    process.env.REFRESH_PROXY_CACHE = "1";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await enrichAddresses({ [addr]: { chain: "ethereum" } }, {}, "KEY");
    expect(out[addr].implementation).toBe(oldImpl);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
