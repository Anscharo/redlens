// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { getAddressMap, resetAddressMap, setAddressMap } from "../lib/addressMap";
import { makeAddressInfo } from "../test/fixtures";

const loadAddresses = vi.fn();
vi.mock("../lib/addresses", () => ({ loadAddresses: () => loadAddresses() }));

const { useSharedAddressMap } = await import("./useSharedAddressMap");
const ADDR = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

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
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(loaded);
    expect(getAddressMap()).toBe(loaded);
  });

  it("loads once however many readers subscribe", () => {
    renderHook(() => useSharedAddressMap());
    renderHook(() => useSharedAddressMap());
    renderHook(() => useSharedAddressMap());
    expect(loadAddresses).toHaveBeenCalledTimes(1);
  });

  it("does not load when the map is already set", () => {
    setAddressMap({ [ADDR]: makeAddressInfo() });
    renderHook(() => useSharedAddressMap());
    expect(loadAddresses).not.toHaveBeenCalled();
  });

  it("re-renders when someone else sets the map", () => {
    const { result } = renderHook(() => useSharedAddressMap());
    const readers = { [ADDR]: makeAddressInfo() };
    act(() => setAddressMap(readers));
    expect(result.current).toBe(readers);
  });

  it("never replaces a map set while its own load was in flight", async () => {
    let resolve!: (m: unknown) => void;
    loadAddresses.mockReturnValue(new Promise((r) => (resolve = r)));
    renderHook(() => useSharedAddressMap());
    const readers = { [ADDR]: makeAddressInfo() };
    act(() => setAddressMap(readers));
    await act(async () => {
      resolve({});
      await Promise.resolve();
    });
    expect(getAddressMap()).toBe(readers);
  });
});
