import { beforeEach, describe, expect, it } from "bun:test";
import { currentPrices, resetPriceCache } from "./cache.ts";
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

describe("currentPrices", () => {
  it("fetches once on the first request and serves the cache for the rest of the hour", async () => {
    resetPriceCache(counting(async () => at(3000)));
    const t0 = Date.now();
    expect(await currentPrices(t0)).toEqual(at(3000));
    expect(await currentPrices(t0 + HOUR / 2)).toEqual(at(3000));
    expect(calls).toBe(1);
  });

  it("refreshes after an hour while still answering with the last prices", async () => {
    let usd = 3000;
    resetPriceCache(counting(async () => at(usd)));
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
    resetPriceCache(counting(async () => answer));
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
