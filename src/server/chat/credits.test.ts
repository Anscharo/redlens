// credits.ts: the shared "commons" pool fetcher — parse, floor, cache, and
// fail-safe (null, never a zero pool) on missing key / bad response.
import { describe, it, expect, beforeEach } from "bun:test";
import { fetchCommons, __resetCommonsCache } from "./credits.ts";

const ok = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const status = (code: number): typeof fetch =>
  (async () => new Response("nope", { status: code })) as unknown as typeof fetch;
const boom: typeof fetch = (async () => {
  throw new Error("network down");
}) as unknown as typeof fetch;

describe("fetchCommons", () => {
  beforeEach(() => __resetCommonsCache());

  it("parses total_credits/total_usage into used/total/remaining", async () => {
    const pool = await fetchCommons({ key: "sk-mgmt", fetchImpl: ok({ data: { total_credits: 20, total_usage: 6.4 } }) });
    expect(pool).toEqual({ used: 6.4, total: 20, remaining: 13.6 });
  });

  it("floors remaining at 0 when usage exceeds credits", async () => {
    const pool = await fetchCommons({ key: "sk-mgmt", fetchImpl: ok({ data: { total_credits: 5, total_usage: 7 } }) });
    expect(pool?.remaining).toBe(0);
  });

  it("returns null (feature off) when no management key is set", async () => {
    let called = false;
    const spy: typeof fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect(await fetchCommons({ key: "", fetchImpl: spy })).toBeNull();
    expect(called).toBe(false); // never even hits the network
  });

  it("returns null on a non-2xx response (unknown, not empty)", async () => {
    expect(await fetchCommons({ key: "sk-mgmt", fetchImpl: status(500) })).toBeNull();
  });

  it("returns null when the fetch throws", async () => {
    expect(await fetchCommons({ key: "sk-mgmt", fetchImpl: boom })).toBeNull();
  });

  it("returns null when the payload is missing numeric fields", async () => {
    expect(await fetchCommons({ key: "sk-mgmt", fetchImpl: ok({ data: {} }) })).toBeNull();
  });

  it("serves a cached pool within the TTL without re-fetching", async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const t0 = 1_000_000;
    await fetchCommons({ key: "sk-mgmt", fetchImpl: counting, now: t0 });
    const second = await fetchCommons({ key: "sk-mgmt", fetchImpl: counting, now: t0 + 5_000 });
    expect(calls).toBe(1);
    expect(second?.remaining).toBe(9);
  });

  it("re-fetches once the TTL has elapsed", async () => {
    let calls = 0;
    const counting: typeof fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ data: { total_credits: 10, total_usage: calls } }), { status: 200 });
    }) as unknown as typeof fetch;
    const t0 = 2_000_000;
    await fetchCommons({ key: "sk-mgmt", fetchImpl: counting, now: t0 });
    await fetchCommons({ key: "sk-mgmt", fetchImpl: counting, now: t0 + 31_000 });
    expect(calls).toBe(2);
  });
});
