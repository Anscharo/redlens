// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { getAddressMap, setAddressMap } from "../lib/addressMap";
import { makeAddressInfo } from "../test/fixtures";

const loadAddresses = vi.fn();
vi.mock("../lib/addresses", () => ({ loadAddresses: () => loadAddresses() }));

const { useSharedAddressMap } = await import("./useSharedAddressMap");
const ADDR = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

beforeEach(() => {
  loadAddresses.mockReset();
  setAddressMap({});
});

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

  it("re-renders when someone else sets the map", () => {
    loadAddresses.mockReturnValue(new Promise(() => {}));
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
