import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  loadHistoryBatch,
  loadHistory,
  movePaths,
  prHref,
  severedRange,
  ATLAS_REPO,
  BATCH_MAX,
  type HistoryEntry,
} from "./history";

const entry = (commitHash: string): HistoryEntry => ({
  date: "2024-01-01",
  commitHash,
  changeType: "modified",
});

/** A minimal Response stand-in for the bits loadHistoryBatch/loadHistory read.
 *  `status` defaults to 200 (ok); pass e.g. 404 or 503 to simulate a specific
 *  non-ok response — loadHistory branches its caching behavior on the exact code. */
function jsonRes(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as unknown as Response;
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
    installFetch(() => jsonRes(null, 500));

    const out = await loadHistoryBatch([a]);
    expect(out.get(a)).toEqual([]);

    const getSpy = installFetch(() => jsonRes([entry("bbb")]));
    expect(await loadHistory(a)).toEqual([entry("bbb")]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe("loadHistory", () => {
  it("never rejects — a transient fetch failure resolves to null", async () => {
    const a = freshId();
    installFetch(() => {
      throw new Error("offline");
    });

    await expect(loadHistory(a)).resolves.toBeNull();
  });

  it("retries after a transient failure instead of permanently caching null (unlike a real 404)", async () => {
    const a = freshId();
    installFetch(() => {
      throw new Error("offline");
    });
    expect(await loadHistory(a)).toBeNull();

    // A network blip must not poison the cache — the next call re-fetches
    // and can now succeed.
    const getSpy = installFetch(() => jsonRes([entry("ccc")]));
    expect(await loadHistory(a)).toEqual([entry("ccc")]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit 404 (no backend, e.g. GitHub Pages) IS cached as null — no refetch", async () => {
    const a = freshId();
    const getSpy = installFetch(() => jsonRes(null, 404));
    expect(await loadHistory(a)).toBeNull();
    expect(await loadHistory(a)).toBeNull();
    expect(getSpy).toHaveBeenCalledTimes(1); // second call reused the cached settled promise
  });

  // H1 (deep-QA 2026-08-02): a transient 5xx must NOT be cached like a stable
  // 404 — the server returns 503 on a DB hiccup (src/server/history/history.ts),
  // and that outcome should be retried, not frozen as "no history" all session.
  it("a 503 (transient DB hiccup) is NOT cached — retries instead of freezing on 'no history'", async () => {
    const a = freshId();
    const getSpy1 = installFetch(() => jsonRes(null, 503));
    expect(await loadHistory(a)).toBeNull();
    expect(getSpy1).toHaveBeenCalledTimes(1);

    // Unlike the 404 case above, the next call must re-fetch and can now succeed.
    const getSpy2 = installFetch(() => jsonRes([entry("ddd")]));
    expect(await loadHistory(a)).toEqual([entry("ddd")]);
    expect(getSpy2).toHaveBeenCalledTimes(1);
  });

  it("a 500 behaves the same as a 503 — any non-404 non-ok status is transient", async () => {
    const a = freshId();
    installFetch(() => jsonRes(null, 500));
    expect(await loadHistory(a)).toBeNull();

    const getSpy = installFetch(() => jsonRes([entry("eee")]));
    expect(await loadHistory(a)).toEqual([entry("eee")]);
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});

describe("loadModCounts", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules(); // fresh module-level modCountsCache per test
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("resolves the parsed rows and caches on success", async () => {
    let calls = 0;
    const data = [{ docId: "a", count: 3, lastModified: "2026-01-05", contentCount: 5 }];
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => data } as Response;
    });

    const { loadModCounts } = await import("./history");
    const first = await loadModCounts();
    const second = await loadModCounts();
    expect(first).toEqual(data);
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it("a 404 (no history DB on this deploy) resolves null and IS cached", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: false, status: 404, json: async () => null } as Response;
    });

    const { loadModCounts } = await import("./history");
    expect(await loadModCounts()).toBeNull();
    expect(await loadModCounts()).toBeNull();
    expect(calls).toBe(1); // second call reused the cached settled promise
  });

  it("a non-404 failure (503 DB hiccup) resolves null but evicts the cache — retries next time", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: false, status: 503, json: async () => null } as Response;
    });

    const { loadModCounts } = await import("./history");
    expect(await loadModCounts()).toBeNull();
    expect(calls).toBe(1);

    expect(await loadModCounts()).toBeNull();
    expect(calls).toBe(2); // not cached — retried
  });

  it("a thrown network error resolves null, never a rejection", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    });

    const { loadModCounts } = await import("./history");
    await expect(loadModCounts()).resolves.toBeNull();
  });
});

describe("loadModTimeline", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules(); // fresh module-level modTimelineCache per test
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("resolves the parsed rows and caches on success", async () => {
    let calls = 0;
    const data = [{ month: "2026-01", count: 5 }];
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: true, status: 200, json: async () => data } as Response;
    });

    const { loadModTimeline } = await import("./history");
    const first = await loadModTimeline();
    const second = await loadModTimeline();
    expect(first).toEqual(data);
    expect(second).toBe(first);
    expect(calls).toBe(1);
  });

  it("a 404 (no history DB on this deploy) resolves null and IS cached", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: false, status: 404, json: async () => null } as Response;
    });

    const { loadModTimeline } = await import("./history");
    expect(await loadModTimeline()).toBeNull();
    expect(await loadModTimeline()).toBeNull();
    expect(calls).toBe(1); // second call reused the cached settled promise
  });

  it("a non-404 failure (503 DB hiccup) resolves null but evicts the cache — retries next time", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return { ok: false, status: 503, json: async () => null } as Response;
    });

    const { loadModTimeline } = await import("./history");
    expect(await loadModTimeline()).toBeNull();
    expect(calls).toBe(1);

    expect(await loadModTimeline()).toBeNull();
    expect(calls).toBe(2); // not cached — retried
  });

  it("a thrown network error resolves null, never a rejection", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    });

    const { loadModTimeline } = await import("./history");
    await expect(loadModTimeline()).resolves.toBeNull();
  });
});

describe("movePaths", () => {
  const moved = (e: Partial<HistoryEntry>): HistoryEntry => ({
    date: "2024-01-01",
    commitHash: "abc1234",
    changeType: "moved",
    ...e,
  });

  it("returns the recorded paths when git has them", () => {
    expect(movePaths(moved({ movedFrom: "a.md", movedTo: "b.md" }))).toEqual({ from: "a.md", to: "b.md" });
  });

  it("names the markdown migration's paths, which git records as a rewrite not a rename", () => {
    expect(movePaths(moved({ pr: 117 }))).toEqual({ from: "Sky Atlas.html", to: "Sky Atlas.md" });
  });

  it("is null for a pathless move from any other PR, and for non-moves", () => {
    expect(movePaths(moved({ pr: 236 }))).toBeNull();
    expect(movePaths(moved({ changeType: "modified", movedTo: "b.md" }))).toBeNull();
  });

  // H2 (deep-QA 2026-08-02): the html-era generator used to stamp movedFrom/movedTo
  // with the same doc_no whenever only a title/ancestors changed, producing 335
  // frozen "moved from X to X" rows. Guard the self-move case regardless of cause.
  it("is null for a self-move (movedFrom === movedTo) — no nonsense 'X to X'", () => {
    expect(movePaths(moved({ movedFrom: "A.1.11", movedTo: "A.1.11" }))).toBeNull();
  });

  it("still returns real paths for a genuine move between two different doc_nos", () => {
    // Sanity check the guard is an equality check, not something cruder (e.g.
    // truncation/prefix matching that could false-positive on "A.1" vs "A.11").
    expect(movePaths(moved({ movedFrom: "A.1", movedTo: "A.11" }))).toEqual({ from: "A.1", to: "A.11" });
  });
});

describe("prHref", () => {
  it("prefers the stored URL when the row has one", () => {
    expect(prHref({ pr: 236, prUrl: "https://example.test/pr/236" })).toBe("https://example.test/pr/236");
  });

  it("derives the URL from the number for a reconstructed row with no stored URL", () => {
    // HTML-era rows predate the atlas_prs metadata git-era rows take pr_url
    // from; without this the link renders href-less and is unclickable.
    expect(prHref({ pr: 66 })).toBe(`${ATLAS_REPO}/pull/66`);
  });

  it("is undefined when there is no PR at all", () => {
    expect(prHref({})).toBeUndefined();
  });
});

describe("severedRange", () => {
  it("renders a severed window as a month range", () => {
    expect(severedRange("severed:2024-09-02..2025-05-28")).toBe("2024-09 ~ 2025-05");
  });

  it("is null for a real sha or any other synthetic tag", () => {
    expect(severedRange("4e931df")).toBeNull();
    expect(severedRange("genesis:bafkreih7")).toBeNull();
  });
});
