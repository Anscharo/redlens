// A host that says "slow down" is left alone longer than it asks: at least
// 30 s, three times any Retry-After, doubling per refusal in a row, for every
// caller of that host, and past two minutes not slept through at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backOff, coolingDown, flushCooldowns, holdOff, isRateLimited, politeFetch, resetBackoff, retryAfterMs, useCooldownStore, withBackoff } from "./upstreamBackoff";

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

  it("does not parse a long JSON body again to look for a refusal", async () => {
    const notok = { status: "0", message: "NOTOK", result: "Max calls per sec rate limit reached (5/sec)" };
    vi.stubGlobal("fetch", vi.fn(async () => json(notok, 200, { "content-length": "100000" })));
    await politeFetch("https://long.example/");
    expect(coolingDown("https://long.example/")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => json(notok, 200, { "content-length": "90" })));
    await politeFetch("https://short.example/");
    expect(coolingDown("https://short.example/")).toBe(true);
  });

  it("reads no further than a refusal's length when the body declares none, or declares its compressed size", async () => {
    const long = JSON.stringify({ status: "0", message: "NOTOK", result: "Max calls per sec rate limit reached", pad: "x".repeat(10_000) });
    const chunked = () => new Response(new Blob([long]).stream(), { headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn(async () => chunked()));
    const res = await politeFetch("https://chunked.example/");
    expect(coolingDown("https://chunked.example/")).toBe(false);
    expect((await res.json()).pad).toHaveLength(10_000);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(long, { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "90" } })));
    await politeFetch("https://gzip.example/");
    expect(coolingDown("https://gzip.example/")).toBe(false);
  });

  it("takes a -32005 that says the query asked for too much as the request's fault, not a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "query returned more than 10000 results" } })));
    await politeFetch("https://wide.example/");
    expect(coolingDown("https://wide.example/")).toBe(false);
  });

  it("backs off from GitHub's spent rate limit until three times its reset, and its secondary limit, but not another 403", async () => {
    const reset = String(Math.floor(Date.now() / 1000) + 600);
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "API rate limit exceeded for 1.2.3.4." }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset })));
    await politeFetch("https://api.github.com/repos/x");
    await vi.advanceTimersByTimeAsync(1_799_000);
    expect(coolingDown("https://api.github.com/")).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(coolingDown("https://api.github.com/")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "You have exceeded a secondary rate limit." }, 403, { "retry-after": "60" })));
    await politeFetch("https://ghe.example/x");
    expect(coolingDown("https://ghe.example/")).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Resource not accessible by integration" }, 403)));
    await politeFetch("https://denied.example/x");
    expect(coolingDown("https://denied.example/")).toBe(false);
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

describe("isRateLimited", () => {
  it("takes a status or code only when the error labels it, never a bare number", () => {
    const limited = ["explorer logs: HTTP 429", "HTTP request failed.\n\nStatus: 429\nURL: https://rpc.example", "rpc eth_getLogs: code -32005 limit exceeded", "Too Many Requests", "Max calls per sec rate limit reached"];
    const not = ["rpc eth_getBlockByNumber: no block 429", 'Request body: {"params":["0x1",429]}', "rpc eth_call: code -32000 execution reverted", "rpc eth_getLogs: code -32005 query returned more than 10000 results"];
    expect(limited.map(isRateLimited)).toEqual(limited.map(() => true));
    expect(not.map(isRateLimited)).toEqual(not.map(() => false));
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

  it("lets a process wait for saves still in flight before it exits", async () => {
    let finish = () => {};
    const saved: string[] = [];
    useCooldownStore({ load: async () => [], save: (h) => new Promise((r) => (finish = () => { saved.push(h); r(); })) });
    backOff(URL_A);
    let flushed = false;
    const flush = flushCooldowns().then(() => (flushed = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    finish();
    await flush;
    expect(saved).toEqual(["rpc.example"]);
  });

  it("carries on with in-process cooldowns when the store cannot be read", async () => {
    useCooldownStore({ load: async () => Promise.reject(new Error("db down")), save: async () => Promise.reject(new Error("db down")) });
    await expect(holdOff(URL_A)).resolves.toBeUndefined();
    expect(backOff(URL_A)).toBe(30_000);
  });
});
