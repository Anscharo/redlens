// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";
import { getAddressMap, setAddressMap } from "../lib/addressMap";

const loadAddresses = vi.fn();
vi.mock("../lib/addresses", () => ({
  loadAddresses: (...a: unknown[]) => loadAddresses(...a),
}));

const { useHydrateAddressMap } = await import("./useHydrateAddressMap");

beforeEach(() => {
  loadAddresses.mockReset();
  setAddressMap({});
});

afterEach(cleanup);

describe("useHydrateAddressMap", () => {
  it("loads the addresses into the shared map on mount", async () => {
    const addresses = { "0xabc": { chain: "mainnet" } };
    loadAddresses.mockResolvedValue(addresses);
    renderHook(() => useHydrateAddressMap());
    await waitFor(() => expect(getAddressMap()).toBe(addresses));
  });

  it("swallows a rejected loadAddresses and leaves the map empty", async () => {
    loadAddresses.mockRejectedValue(new Error("boom"));
    renderHook(() => useHydrateAddressMap());
    await waitFor(() => expect(loadAddresses).toHaveBeenCalledTimes(1));
    // Give the rejection's .catch a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(getAddressMap()).toEqual({});
  });

  it("only loads once across re-renders", async () => {
    loadAddresses.mockResolvedValue({ "0xabc": { chain: "mainnet" } });
    const { rerender } = renderHook(() => useHydrateAddressMap());
    rerender();
    rerender();
    await waitFor(() => expect(Object.keys(getAddressMap())).toHaveLength(1));
    expect(loadAddresses).toHaveBeenCalledTimes(1);
  });
});
