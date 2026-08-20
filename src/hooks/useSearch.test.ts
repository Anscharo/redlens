// @vitest-environment jsdom
// Reference mocked-Worker test. useSearch owns the search worker lifecycle:
// ready-gating, the results-matched-by-id race guard, and error surfacing. None
// of that needs a real MiniSearch worker — only the postMessage protocol — so we
// drive a MockWorker and assert the state transitions. This is the pattern other
// worker-backed hooks/components copy.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// The hook eagerly preloads docs+addresses over the worker; stub both so no fetch
// happens. Returning empty payloads is fine — the MockWorker ignores them.
vi.mock("@/lib/docs", () => ({
  loadAtlas: vi.fn(() => Promise.resolve({ docs: {}, byParent: new Map(), docNoToId: new Map(), atlasCommit: null })),
}));
vi.mock("@/lib/addresses", () => ({
  loadAddresses: vi.fn(() => Promise.resolve({})),
}));

import { useSearch } from "./useSearch";
import { installMockWorker, MockWorker } from "../test/mocks";
import { makeSearchHit } from "../test/fixtures";

let restore: () => void;
beforeEach(() => {
  restore = installMockWorker();
});
afterEach(() => {
  restore();
  vi.clearAllMocks();
});

// Drive the worker to its ready state and let React flush.
async function becomeReady() {
  await act(async () => {
    MockWorker.last().emit({ type: "ready" });
  });
}

describe("useSearch ready gating", () => {
  it("starts in loading and flips to idle once the worker is ready", async () => {
    const { result } = renderHook(() => useSearch());
    expect(result.current.state.status).toBe("loading");
    expect(result.current.ready).toBe(false);

    await becomeReady();

    expect(result.current.ready).toBe(true);
    expect(result.current.state.status).toBe("idle");
  });

  it("queues a query issued before ready and runs it once ready fires", async () => {
    const { result } = renderHook(() => useSearch());

    act(() => result.current.search("accord"));
    // Searching shown immediately; nothing posted to the not-yet-ready worker.
    expect(result.current.state.status).toBe("searching");
    expect(MockWorker.last().posted.some((m) => (m as { type: string }).type === "query")).toBe(false);

    await becomeReady();

    const query = MockWorker.last().posted.find((m) => (m as { type: string }).type === "query");
    expect(query).toMatchObject({ type: "query", q: "accord" });
  });
});

describe("useSearch result handling", () => {
  it("resolves a query to done with the worker's hits", async () => {
    const { result } = renderHook(() => useSearch());
    await becomeReady();

    act(() => result.current.search("accord"));
    const hit = makeSearchHit({ title: "Accord" });
    await act(async () => {
      MockWorker.last().emit({ type: "results", id: 1, hits: [hit], durationMs: 7 });
    });

    expect(result.current.state).toMatchObject({
      status: "done",
      hits: [hit],
      durationMs: 7,
      query: "accord",
    });
  });

  it("ignores stale results from a superseded query (race guard)", async () => {
    const { result } = renderHook(() => useSearch());
    await becomeReady();

    act(() => result.current.search("first")); // id 1
    act(() => result.current.search("second")); // id 2

    // Late result for the abandoned first query must be dropped.
    await act(async () => {
      MockWorker.last().emit({ type: "results", id: 1, hits: [makeSearchHit({ title: "stale" })], durationMs: 1 });
    });
    expect(result.current.state.status).toBe("searching");

    // The in-flight query's result is accepted.
    const fresh = makeSearchHit({ title: "fresh" });
    await act(async () => {
      MockWorker.last().emit({ type: "results", id: 2, hits: [fresh], durationMs: 2 });
    });
    expect(result.current.state).toMatchObject({ status: "done", hits: [fresh], query: "second" });
  });

  it("clears to idle on an empty/whitespace query without posting", async () => {
    const { result } = renderHook(() => useSearch());
    await becomeReady();
    const before = MockWorker.last().posted.length;

    act(() => result.current.search("   "));

    expect(result.current.state.status).toBe("idle");
    expect(MockWorker.last().posted.length).toBe(before);
  });
});

describe("useSearch error handling", () => {
  it("surfaces a worker error event as an error state", async () => {
    const { result } = renderHook(() => useSearch());
    await act(async () => {
      MockWorker.last().emitError("boom");
    });
    expect(result.current.state).toMatchObject({ status: "error", message: "boom" });
  });

  it("surfaces an error message posted by the worker", async () => {
    const { result } = renderHook(() => useSearch());
    await becomeReady();
    await act(async () => {
      MockWorker.last().emit({ type: "error", message: "index corrupt" });
    });
    expect(result.current.state).toMatchObject({ status: "error", message: "index corrupt" });
  });

  it("terminates the worker on unmount", async () => {
    const { unmount } = renderHook(() => useSearch());
    const worker = MockWorker.last();
    await waitFor(() => expect(worker.terminated).toBe(false));
    unmount();
    expect(worker.terminated).toBe(true);
  });
});
