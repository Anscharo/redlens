import { beforeEach, describe, expect, it } from "bun:test";
import { currentPrices, priceRefreshMs, resetPriceCache } from "./cache.ts";
import type { PriceMap } from "../../lib/tokenPrices.ts";

const HOUR = 60 * 60 * 1000;
const at = (usd: number): PriceMap => ({ ETH: { usd, asOf: "2026-11-02T10:00:00.000Z" } });

let calls = 0;
const counting = (answer: () => Promise<PriceMap>) => () => {
  calls++;
  return answer();
};

beforeEach(() => {
  calls = 0;
});

describe("priceRefreshMs", () => {
  it("refreshes production every two hours, a PR environment never, everything else daily", () => {
    expect(priceRefreshMs("production", false)).toBe(2 * HOUR);
    expect(priceRefreshMs("redlens-pr-541", true)).toBe(Infinity);
    expect(priceRefreshMs("development", false)).toBe(24 * HOUR);
    expect(priceRefreshMs("", false)).toBe(24 * HOUR);
  });
});

describe("currentPrices", () => {
  it("in a PR environment fetches once and never again", async () => {
    resetPriceCache(counting(async () => at(3000)), Infinity);
    const t0 = Date.now();
    await currentPrices(t0);
    await currentPrices(t0 + 30 * 24 * HOUR);
    expect(calls).toBe(1);
  });

  it("in a PR environment still retries a fetch that failed", async () => {
    resetPriceCache(counting(() => Promise.reject(new Error("down"))), Infinity);
    const t0 = Date.now();
    await currentPrices(t0);
    await currentPrices(t0 + 6 * 60_000);
    expect(calls).toBe(2);
  });

  it("fetches once on the first request and serves the cache until the interval passes", async () => {
    resetPriceCache(counting(async () => at(3000)), HOUR);
    const t0 = Date.now();
    expect(await currentPrices(t0)).toEqual(at(3000));
    expect(await currentPrices(t0 + HOUR / 2)).toEqual(at(3000));
    expect(calls).toBe(1);
  });

  it("refreshes after the interval while still answering with the last prices", async () => {
    let usd = 3000;
    resetPriceCache(counting(async () => at(usd)), HOUR);
    const t0 = Date.now();
    await currentPrices(t0);
    usd = 3100;
    expect(await currentPrices(t0 + HOUR + 1)).toEqual(at(3000));
    expect(calls).toBe(2);
    await Promise.resolve();
    expect(await currentPrices(t0 + HOUR + 2)).toEqual(at(3100));
  });

  it("keeps a symbol the latest answer left out", async () => {
    let answer: PriceMap = { ...at(3000), SKY: { usd: 0.07, asOf: "2026-11-02T10:00:00.000Z" } };
    resetPriceCache(counting(async () => answer), HOUR);
    const t0 = Date.now();
    await currentPrices(t0);
    answer = at(3100);
    await currentPrices(t0 + HOUR + 1);
    await Promise.resolve();
    const out = await currentPrices(t0 + HOUR + 2);
    expect(out.ETH.usd).toBe(3100);
    expect(out.SKY.usd).toBe(0.07);
  });

  it("answers without prices when DefiLlama fails, and waits before asking again", async () => {
    resetPriceCache(counting(() => Promise.reject(new Error("down"))));
    const t0 = Date.now();
    expect(await currentPrices(t0)).toEqual({});
    expect(await currentPrices(t0 + 60_000)).toEqual({});
    expect(calls).toBe(1);
    await currentPrices(t0 + 6 * 60_000);
    expect(calls).toBe(2);
  });

  it("asks once while a fetch is still running", async () => {
    let release!: (p: PriceMap) => void;
    resetPriceCache(counting(() => new Promise<PriceMap>((r) => (release = r))));
    const t0 = Date.now();
    const first = currentPrices(t0);
    const second = currentPrices(t0 + 1);
    release(at(3000));
    expect(await first).toEqual(at(3000));
    expect(await second).toEqual(at(3000));
    expect(calls).toBe(1);
  });
});
