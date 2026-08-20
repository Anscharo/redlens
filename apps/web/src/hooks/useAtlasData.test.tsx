// @vitest-environment jsdom
// useLoaded rejection handling (deep review Exec #5): a rejected loader must not
// become a permanent "Loading…" + an unhandled rejection. By default the error
// re-throws during render so an ErrorBoundary catches it; `{ soft: true }` swallows
// it and returns null so an enrichment failure doesn't blank the page.
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, renderHook, waitFor, act } from "@testing-library/react";
import { useLoaded, useAtlasData } from "./useAtlasData";

// --- Mocks for the useAtlasData() loader orchestration -----------------------
const loaders = vi.hoisted(() => ({
  loadAtlas: vi.fn(),
  loadAtlasShallow: vi.fn(),
  loadAddresses: vi.fn(),
  loadChainState: vi.fn(),
  loadGlossary: vi.fn(),
  setAddressMap: vi.fn(),
  base: "",
}));
vi.mock("../lib/docs", () => ({ loadAtlas: loaders.loadAtlas, loadAtlasShallow: loaders.loadAtlasShallow }));
vi.mock("../lib/addresses", () => ({ loadAddresses: loaders.loadAddresses }));
vi.mock("../lib/chainstate", () => ({ loadChainState: loaders.loadChainState }));
vi.mock("../lib/glossary", () => ({ loadGlossary: loaders.loadGlossary }));
vi.mock("../lib/addressMap", () => ({ setAddressMap: loaders.setAddressMap }));
vi.mock("../lib/dataSource", () => ({ useDataSource: () => ({ base: loaders.base }) }));

class Boundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  render() {
    return this.state.err ? <div>caught:{this.state.err.message}</div> : this.props.children;
  }
}

function Probe({ loader, soft }: { loader: () => Promise<string>; soft?: boolean }) {
  const v = useLoaded(loader, soft ? { soft: true } : undefined);
  return <div data-testid="val">{v === null ? "null" : v}</div>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useLoaded", () => {
  it("returns the resolved value", async () => {
    render(
      <Boundary>
        <Probe loader={() => Promise.resolve("hello")} />
      </Boundary>,
    );
    expect(await screen.findByText("hello")).toBeTruthy();
  });

  it("re-throws a load failure to the ErrorBoundary by default", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // silence boundary noise
    render(
      <Boundary>
        <Probe loader={() => Promise.reject(new Error("load failed"))} />
      </Boundary>,
    );
    expect(await screen.findByText(/caught:load failed/)).toBeTruthy();
  });

  it("swallows a load failure in soft mode and stays null (no throw)", async () => {
    render(
      <Boundary>
        <Probe loader={() => Promise.reject(new Error("load failed"))} soft />
      </Boundary>,
    );
    // Let the effect + rejection settle across a couple of microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.queryByText(/caught:/)).toBeNull();
    expect(screen.getByTestId("val").textContent).toBe("null");
  });
});

describe("useAtlasData", () => {
  const shallowAtlas = { byParent: new Map() } as never;
  const fullAtlas = { byParent: new Map() } as never;

  beforeEach(() => {
    // Clear call counts so each test is isolated — these vi.fn()s are created
    // once via vi.hoisted and are NOT reset by afterEach's restoreAllMocks
    // (that only restores spies). Without this, toHaveBeenCalledTimes counts
    // leak across tests. mockClear keeps the implementations set below.
    loaders.loadAtlas.mockClear();
    loaders.loadAtlasShallow.mockClear();
    loaders.loadAddresses.mockClear();
    loaders.loadChainState.mockClear();
    loaders.loadGlossary.mockClear();
    loaders.setAddressMap.mockClear();
    loaders.base = "";
    loaders.loadAtlasShallow.mockResolvedValue(shallowAtlas);
    loaders.loadAtlas.mockResolvedValue(fullAtlas);
    loaders.loadAddresses.mockResolvedValue({ "0xabc": { chain: "ethereum" } });
    loaders.loadChainState.mockResolvedValue({ values: {} });
    loaders.loadGlossary.mockResolvedValue({ term: [] });
  });

  it("phase 1 shows a shallow (incomplete, enrichment-null) bundle, then phase 2 completes it with enrichments", async () => {
    const { result } = renderHook(() => useAtlasData());
    // Eventually the full phase-2 bundle lands: complete + enrichments populated.
    await waitFor(() => expect(result.current.data?.complete).toBe(true));
    expect(result.current.data?.addresses).toEqual({ "0xabc": { chain: "ethereum" } });
    expect(result.current.data?.chainState).toEqual({ values: {} });
    expect(result.current.data?.glossary).toEqual({ term: [] });
    expect(result.current.shallowError).toBeNull();
    expect(result.current.deepError).toBeNull();
    // Address map hydrated from the resolved addresses.
    expect(loaders.setAddressMap).toHaveBeenCalledWith({ "0xabc": { chain: "ethereum" } });
  });

  it("tolerates enrichment failures: still completes with null enrichments and no setAddressMap", async () => {
    loaders.loadAddresses.mockRejectedValue(new Error("no addresses.json"));
    loaders.loadChainState.mockRejectedValue(new Error("no chain-state.json"));
    loaders.loadGlossary.mockRejectedValue(new Error("no glossary.json"));
    const { result } = renderHook(() => useAtlasData());
    await waitFor(() => expect(result.current.data?.complete).toBe(true));
    expect(result.current.data?.addresses).toBeNull();
    expect(result.current.data?.glossary).toBeNull();
    expect(loaders.setAddressMap).not.toHaveBeenCalled();
  });

  // R3: a rejected loader used to be swallowed silently (both phases), leaving
  // callers with no way to distinguish "still loading" from "failed forever"
  // and no way to retry. Both phases now surface a real error instead.
  it("surfaces shallowError (not an eternal null) when the load-bearing docs fetch rejects", async () => {
    loaders.loadAtlasShallow.mockRejectedValue(new Error("no docs-shallow.json"));
    loaders.loadAtlas.mockRejectedValue(new Error("no docs-deep.json"));
    const { result } = renderHook(() => useAtlasData());
    await waitFor(() => expect(result.current.shallowError).not.toBeNull());
    // No unhandled rejection / throw — the hook itself never throws.
    expect(result.current.data).toBeNull();
    expect(result.current.shallowError?.message).toBe("no docs-shallow.json");
  });

  it("a deep-only failure keeps the already-rendered shallow tree and surfaces deepError, not shallowError", async () => {
    loaders.loadAtlas.mockRejectedValue(new Error("no docs-deep.json"));
    const { result } = renderHook(() => useAtlasData());
    await waitFor(() => expect(result.current.deepError).not.toBeNull());
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.complete).toBe(false);
    expect(result.current.shallowError).toBeNull();
    expect(result.current.deepError?.message).toBe("no docs-deep.json");
  });

  it("retry() clears deepError optimistically without touching the already-rendered tree, then completes on success", async () => {
    loaders.loadAtlas.mockRejectedValueOnce(new Error("no docs-deep.json"));
    const { result } = renderHook(() => useAtlasData());
    await waitFor(() => expect(result.current.deepError).not.toBeNull());
    const treeBeforeRetry = result.current.data;

    act(() => result.current.retry());
    // Optimistic clear + the retried loadAtlas mock now resolves — no second
    // rejection queued via mockRejectedValueOnce.
    expect(result.current.deepError).toBeNull();
    expect(result.current.data).toBe(treeBeforeRetry);

    await waitFor(() => expect(result.current.data?.complete).toBe(true));
    expect(result.current.deepError).toBeNull();
    expect(loaders.loadAtlas).toHaveBeenCalledTimes(2);
  });

  it("passes the data-source base through to every loader", async () => {
    loaders.base = "/preview/abc";
    renderHook(() => useAtlasData());
    await waitFor(() => expect(loaders.loadAtlas).toHaveBeenCalledWith("/preview/abc"));
    expect(loaders.loadAtlasShallow).toHaveBeenCalledWith("/preview/abc");
    expect(loaders.loadGlossary).toHaveBeenCalledWith("/preview/abc");
  });
});
