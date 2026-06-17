import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadHistoryBatch, loadHistory, BATCH_MAX, type HistoryEntry } from "./history";

const entry = (commitHash: string): HistoryEntry => ({
  date: "2024-01-01",
  commitHash,
  changeType: "modified",
});

/** A minimal Response stand-in for the bits loadHistoryBatch/loadHistory read. */
function jsonRes(data: unknown, ok = true) {
  return { ok, json: async () => data } as unknown as Response;
}

/** loadHistoryBatch POSTs to /api/history/batch; loadHistory GETs
 *  /api/history/:id. Branch the mock on URL so cache-reuse assertions are
 *  unambiguous. */
function installFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  // Always async: loadHistory chains `.then` directly on fetch()'s return, so
  // the mock must be thenable; a throw inside impl surfaces as a rejection,
  // which both call sites handle.
  const spy = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal("fetch", spy);
  return spy;
}

// The module-level cache is shared and not resettable, so every test uses
// freshly-suffixed ids to avoid cross-test contamination.
let n = 0;
const freshId = () => `id-${n++}-${"a".repeat(4)}`;

beforeEach(() => {
  n += 1000; // widen the gap between tests' id ranges
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadHistoryBatch", () => {
  it("maps response entries by id and fills absent ids with []", async () => {
    const a = freshId();
    const b = freshId();
    installFetch(() => jsonRes({ [a]: [entry("aaa")] }));

    const out = await loadHistoryBatch([a, b]);
    expect(out.get(a)).toEqual([entry("aaa")]);
    expect(out.get(b)).toEqual([]); // present in request, absent from response
  });

  it("dedups ids before sending the request", async () => {
    const a = freshId();
    const spy = installFetch(() => jsonRes({}));

    await loadHistoryBatch([a, a, a]);
    expect(spy).toHaveBeenCalledTimes(1);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.ids).toEqual([a]);
  });

  it("splits more than BATCH_MAX ids into multiple requests, none over the cap", async () => {
    const ids = Array.from({ length: BATCH_MAX + 1 }, () => freshId());
    const spy = installFetch(() => jsonRes({}));

    await loadHistoryBatch(ids);
    expect(spy).toHaveBeenCalledTimes(2);
    const sizes = spy.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).ids.length,
    );
    expect(sizes).toEqual([BATCH_MAX, 1]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(BATCH_MAX);
  });

  it("seeds the single-doc cache so a later loadHistory reuses without refetching", async () => {
    const a = freshId(); // has history
    const b = freshId(); // empty history
    const spy = installFetch(() => jsonRes({ [a]: [entry("aaa")] }));

    await loadHistoryBatch([a, b]);
    expect(spy).toHaveBeenCalledTimes(1);

    // No further fetches: both resolve from the seeded cache.
    expect(await loadHistory(a)).toEqual([entry("aaa")]);
    expect(await loadHistory(b)).toBeNull(); // empty entries seed null
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("maps every id to [] and does not seed the cache when the request fails", async () => {
    const a = freshId();
    installFetch(() => {
      throw new Error("offline");
    });

    const out = await loadHistoryBatch([a]);
    expect(out.get(a)).toEqual([]);

    // Cache was not poisoned: loadHistory now issues its own GET.
    const getSpy = installFetch(() => jsonRes([entry("aaa")]));
    expect(await loadHistory(a)).toEqual([entry("aaa")]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("maps every id to [] when the response is not ok, without seeding", async () => {
    const a = freshId();
    installFetch(() => jsonRes(null, false));

    const out = await loadHistoryBatch([a]);
    expect(out.get(a)).toEqual([]);

    const getSpy = installFetch(() => jsonRes([entry("bbb")]));
    expect(await loadHistory(a)).toEqual([entry("bbb")]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
