// A host that says "slow down" is left alone longer than it asks: at least
// 30 s, three times any Retry-After, doubling per refusal in a row, for every
// caller of that host, and past two minutes not slept through at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backOff, coolingDown, holdOff, politeFetch, resetBackoff, retryAfterMs, useCooldownStore, withBackoff } from "./upstreamBackoff";

const URL_A = "https://rpc.example/a";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => {
  resetBackoff();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("retryAfterMs", () => {
  it("reads seconds and HTTP dates, and nothing else", () => {
    expect(retryAfterMs("7")).toBe(7000);
    expect(retryAfterMs(new Date(Date.now() + 60_000).toUTCString())).toBe(60_000);
    expect(retryAfterMs("soon")).toBe(0);
    expect(retryAfterMs(null)).toBe(0);
  });
});

describe("backOff", () => {
  it("waits at least 30 s, three times any Retry-After, and doubles per refusal in a row", () => {
    expect(backOff(URL_A)).toBe(30_000);
    expect(backOff(URL_A)).toBe(60_000);
    expect(backOff("https://other.example/x", "40")).toBe(120_000);
    expect(coolingDown("https://rpc.example/b")).toBe(true);
  });
});

describe("holdOff", () => {
  it("sleeps through a short cooldown and refuses a long one", async () => {
    backOff(URL_A);
    let done = false;
    const p = holdOff(URL_A).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    await p;
    expect(done).toBe(true);
    backOff(URL_A, "3600");
    await expect(holdOff(URL_A)).rejects.toThrow(/cooling down after a rate limit/);
  });
});

describe("politeFetch", () => {
  it("starts a cooldown on a 429, a JSON-RPC limit error or an explorer NOTOK limit, and not on a normal answer", async () => {
    const answers = [
      new Response("slow", { status: 429, headers: { "retry-after": "1" } }),
      json({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "limit exceeded" } }),
      json({ status: "0", message: "NOTOK", result: "Max calls per sec rate limit reached (5/sec)" }),
      json({ status: "0", message: "NOTOK", result: "Error! Invalid address format" }),
      new Response("rate limit appears in a document", { status: 200 }),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => answers.shift()!));
    for (const host of ["a", "b", "c"]) {
      await politeFetch(`https://${host}.example/`);
      expect(coolingDown(`https://${host}.example/`)).toBe(true);
    }
    for (const host of ["d", "e"]) {
      await politeFetch(`https://${host}.example/`);
      expect(coolingDown(`https://${host}.example/`)).toBe(false);
    }
  });

  it("makes the next request to that host wait out the cooldown", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("", { status: 429 })).mockResolvedValue(json({ result: "0x1" }));
    vi.stubGlobal("fetch", fetch);
    await politeFetch(URL_A);
    const next = politeFetch(URL_A);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await next;
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("withBackoff", () => {
  it("retries a refusal after its cooldown and other failures after a short pause", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("HTTP request failed. Status: 429")).mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValue("ok");
    const p = withBackoff(URL_A, fn);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toBe("ok");
  });

  it("gives up after its attempts", async () => {
    const p = withBackoff(URL_A, async () => Promise.reject(new Error("boom")), 2);
    const done = expect(p).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
  });
});

describe("cooldown store", () => {
  it("loads saved cooldowns before the first request and saves each new one", async () => {
    const saved: [string, number][] = [];
    useCooldownStore({ load: async () => [{ host: "rpc.example", until: Date.now() + 10 * 60_000 }], save: async (h, u) => void saved.push([h, u]) });
    await expect(holdOff(URL_A)).rejects.toThrow(/cooling down/);
    backOff("https://new.example/");
    expect(saved).toEqual([["new.example", Date.now() + 30_000]]);
  });

  it("carries on with in-process cooldowns when the store cannot be read", async () => {
    useCooldownStore({ load: async () => Promise.reject(new Error("db down")), save: async () => Promise.reject(new Error("db down")) });
    await expect(holdOff(URL_A)).resolves.toBeUndefined();
    expect(backOff(URL_A)).toBe(30_000);
  });
});
