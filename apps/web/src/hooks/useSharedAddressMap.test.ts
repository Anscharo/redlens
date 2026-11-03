// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, act, cleanup } from "@testing-library/react";
import { getAddressMap, resetAddressMap, setAddressMap } from "../lib/addressMap";
import { DataSourceContext } from "../lib/dataSource";
import { makeAddressInfo } from "../test/fixtures";

const loadAddresses = vi.fn();
vi.mock("../lib/addresses", () => ({ loadAddresses: (base: string) => loadAddresses(base) }));

const { useSharedAddressMap } = await import("./useSharedAddressMap");
const ADDR = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";
const PREVIEW = "/api/preview/abc123/";

function inSource(base: string) {
  return ({ children }: { children: ReactNode }) =>
    createElement(DataSourceContext.Provider, { value: { base, preview: { id: "1", sha: "abc123" } } }, children);
}

const flush = () => act(async () => {
  await Promise.resolve();
});

beforeEach(() => {
  loadAddresses.mockReset();
  // Pending unless a test says otherwise, so a load never settles into the next test.
  loadAddresses.mockReturnValue(new Promise(() => {}));
  resetAddressMap();
});
afterEach(cleanup);

describe("useSharedAddressMap", () => {
  it("loads the map on a page that has not, and re-renders with it", async () => {
    const loaded = { [ADDR]: makeAddressInfo() };
    loadAddresses.mockResolvedValue(loaded);
    const { result } = renderHook(() => useSharedAddressMap());
    expect(result.current).toEqual({});
    await flush();
    expect(result.current).toBe(loaded);
    expect(getAddressMap()).toBe(loaded);
  });

  it("loads once however many readers subscribe", () => {
    renderHook(() => useSharedAddressMap());
    renderHook(() => useSharedAddressMap());
    renderHook(() => useSharedAddressMap());
    expect(loadAddresses).toHaveBeenCalledTimes(1);
  });

  it("loads the active data source's map, so a preview names the addresses it adds", async () => {
    const preview = { [ADDR]: makeAddressInfo({ chainlogId: "Added In Preview" }) };
    loadAddresses.mockImplementation((base: string) => Promise.resolve(base === PREVIEW ? preview : {}));
    const { result } = renderHook(() => useSharedAddressMap(), { wrapper: inSource(PREVIEW) });
    await flush();
    expect(loadAddresses).toHaveBeenCalledWith(PREVIEW);
    expect(result.current).toBe(preview);
  });

  it("does not load a base whose map the reader already set", () => {
    setAddressMap({ [ADDR]: makeAddressInfo() }, PREVIEW);
    renderHook(() => useSharedAddressMap(), { wrapper: inSource(PREVIEW) });
    expect(loadAddresses).not.toHaveBeenCalled();
  });

  it("replaces a map set for another base", async () => {
    const preview = { [ADDR]: makeAddressInfo() };
    setAddressMap({}, "/api/atlas/live/");
    loadAddresses.mockResolvedValue(preview);
    const { result } = renderHook(() => useSharedAddressMap(), { wrapper: inSource(PREVIEW) });
    await flush();
    expect(result.current).toBe(preview);
  });

  it("does not load when a map is set without a base", () => {
    setAddressMap({ [ADDR]: makeAddressInfo() });
    renderHook(() => useSharedAddressMap(), { wrapper: inSource(PREVIEW) });
    expect(loadAddresses).not.toHaveBeenCalled();
  });

  it("re-renders when someone else sets the map", () => {
    const { result } = renderHook(() => useSharedAddressMap());
    const readers = { [ADDR]: makeAddressInfo() };
    act(() => setAddressMap(readers));
    expect(result.current).toBe(readers);
  });

  it("never replaces a map set for its base while its own load was in flight", async () => {
    let resolve!: (m: unknown) => void;
    loadAddresses.mockReturnValue(new Promise((r) => (resolve = r)));
    renderHook(() => useSharedAddressMap(), { wrapper: inSource(PREVIEW) });
    const readers = { [ADDR]: makeAddressInfo() };
    act(() => setAddressMap(readers, PREVIEW));
    await act(async () => {
      resolve({});
      await Promise.resolve();
    });
    expect(getAddressMap()).toBe(readers);
  });
});
