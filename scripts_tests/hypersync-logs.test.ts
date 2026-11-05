// The HyperSync source behind the PAU crawl, against a stubbed fetch. Pinned:
// one query names every address and ORs the topic0s, with an exclusive
// to_block one past the window; each log takes its block's timestamp from the
// same answer; the answer covers up to next_block - 1, never past the window;
// an answer that makes no progress or lacks a usable timestamp throws; a busy
// 503 is asked again before the source fails; a 429 holds every chain's host,
// for three times the seconds HyperSync says its window resets in; an
// unflagged chain has no source.
import { afterEach, describe, expect, it, vi } from "vitest";
import { hypersyncSource } from "../scripts/lib/hypersync-logs.ts";
import { resetBackoff } from "../src/lib/upstreamBackoff.ts";
import { isRateLimited } from "../src/lib/upstreamRefusal.ts";

interface Seen { url: string; init: { method: string; headers: Record<string, string>; body?: string } }
let seen: Seen[];

function stub(answer: (url: string) => Response) {
  seen = [];
  vi.stubGlobal("fetch", async (url: string, init: Seen["init"]) => {
    seen.push({ url, init });
    return answer(url);
  });
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const hsLog = (block: number, index: number) => ({ block_number: block, log_index: index, transaction_hash: `0x${block}`, address: "0xAA", topic0: "0xt1", topic1: "0xk", topic2: null, topic3: null, data: "0x" });

const FAST = { gapMs: 0, busyWaitsMs: [0, 0] };
const base = () => hypersyncSource("base", "tok", FAST)!;

afterEach(() => {
  vi.unstubAllGlobals();
  resetBackoff();
});

describe("hypersyncSource", () => {
  it("queries every address and topic0 at once and returns the logs with their block times, up to next_block - 1", async () => {
    stub(() => json({ next_block: 151, data: [{ blocks: [{ number: 120, timestamp: "0x64" }, { number: 110, timestamp: 90 }], logs: [hsLog(120, 0), hsLog(110, 3)] }] }));
    const out = await base().logs(["0xa", "0xb"], ["0xt1", "0xt2"], 100, 999);
    expect(seen[0].url).toBe("https://8453.hypersync.xyz/query");
    expect(seen[0].init.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(seen[0].init.body!)).toMatchObject({ from_block: 100, to_block: 1000, logs: [{ address: ["0xa", "0xb"], topics: [["0xt1", "0xt2"]] }] });
    expect(out.to).toBe(150);
    expect(out.logs).toEqual([
      { address: "0xaa", topics: ["0xt1", "0xk"], data: "0x", blockNumber: 110, timeStamp: 90, transactionHash: "0x110", logIndex: 3 },
      { address: "0xaa", topics: ["0xt1", "0xk"], data: "0x", blockNumber: 120, timeStamp: 100, transactionHash: "0x120", logIndex: 0 },
    ]);
  });
  it("never claims past the window it was asked", async () => {
    stub(() => json({ next_block: 5_000, data: [] }));
    expect((await base().logs(["0xa"], ["0xt1"], 100, 999)).to).toBe(999);
  });
  it("throws on an answer that makes no progress", async () => {
    stub(() => json({ next_block: 100, data: [] }));
    await expect(base().logs(["0xa"], ["0xt1"], 100, 999)).rejects.toThrow("hypersync: no progress from block 100 (next_block 100)");
  });
  it.each([
    ["absent", []],
    ["null", [{ number: 120, timestamp: null }]],
    ["missing", [{ number: 120 }]],
    ["zero", [{ number: 120, timestamp: "0x0" }]],
  ])("throws rather than store a log whose block timestamp is %s", async (_case, blocks) => {
    stub(() => json({ next_block: 200, data: [{ blocks, logs: [hsLog(120, 0)] }] }));
    await expect(base().logs(["0xa"], ["0xt1"], 100, 999)).rejects.toThrow("hypersync: no timestamp for block 120");
  });
  it("asks a busy (503) query again, and fails only when it stays busy", async () => {
    let busy = 2;
    stub(() => (busy-- > 0 ? json({}, 503) : json({ next_block: 151, data: [] })));
    expect((await base().logs(["0xa"], ["0xt1"], 100, 999)).to).toBe(150);
    expect(seen).toHaveLength(3);
    stub(() => json({}, 503));
    await expect(base().logs(["0xa"], ["0xt1"], 100, 999)).rejects.toThrow("hypersync: HTTP 503");
    expect(seen).toHaveLength(3);
  });
  it("on a 429 throws a rate limit and holds every chain's host for three times the reset", async () => {
    stub(() => json({}, 429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "60" }));
    const err = await base().logs(["0xa"], ["0xt1"], 100, 999).catch((e: Error) => e);
    expect(isRateLimited(err)).toBe(true);
    await expect(hypersyncSource("ethereum", "tok", FAST)!.head()).rejects.toThrow(/hypersync\.xyz is cooling down after a rate limit/);
    expect(seen).toHaveLength(1);
  });
  it("reads the head from /height and starts every contract at block 0", async () => {
    stub(() => json({ height: 53_544_440 }));
    expect(await base().head()).toBe(53_544_440);
    expect(seen[0]).toMatchObject({ url: "https://8453.hypersync.xyz/height", init: { method: "GET" } });
    expect(await base().deployBlock("0xa", 1)).toBe(0);
  });
  it.each([[{}], [{ height: "soon" }], [{ height: 0 }]])("throws on a /height answer without a positive height (%j)", async (answer) => {
    stub(() => json(answer));
    await expect(base().head()).rejects.toThrow("hypersync: no height in");
  });
  it("waits out the account's cooldown before starting the request's timeout", async () => {
    vi.useFakeTimers();
    stub(() => json({}, 429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1" }));
    await base().head().catch(() => {});
    const cooledAt = Date.now() + 30_000;
    const created: number[] = [];
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => (created.push(Date.now()), timeout(ms)));
    stub(() => json({ height: 7 }));
    const head = base().head();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await head).toBe(7);
    expect(created[0]).toBeGreaterThanOrEqual(cooledAt);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("spaces request starts by the account's gap", async () => {
    stub(() => json({ height: 1 }));
    const src = hypersyncSource("base", "tok", { ...FAST, gapMs: 40 })!;
    const t0 = Date.now();
    await Promise.all([src.head(), src.head()]);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(35);
  });
  it("has no source for a chain the registry does not flag", () => {
    expect(hypersyncSource("xlayer", "tok")).toBeNull();
  });
});
