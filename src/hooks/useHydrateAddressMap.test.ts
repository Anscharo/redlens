// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup, waitFor } from "@testing-library/react";

const loadAddresses = vi.fn();
const setAddressMap = vi.fn();

vi.mock("@/lib/addresses", () => ({
  loadAddresses: (...a: unknown[]) => loadAddresses(...a),
}));
vi.mock("@/lib/addressMap", () => ({
  setAddressMap: (...a: unknown[]) => setAddressMap(...a),
}));

beforeEach(() => {
  vi.resetModules();
  loadAddresses.mockReset();
  setAddressMap.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useHydrateAddressMap", () => {
  it("calls setAddressMap with the resolved addresses on mount", async () => {
    const addresses = { "0xabc": { chain: "mainnet" } };
    loadAddresses.mockResolvedValue(addresses);
    const { useHydrateAddressMap } = await import("./useHydrateAddressMap");
    renderHook(() => useHydrateAddressMap());
    await waitFor(() => expect(setAddressMap).toHaveBeenCalledWith(addresses));
  });

  it("swallows a rejected loadAddresses without calling setAddressMap", async () => {
    loadAddresses.mockRejectedValue(new Error("boom"));
    const { useHydrateAddressMap } = await import("./useHydrateAddressMap");
    renderHook(() => useHydrateAddressMap());
    await waitFor(() => expect(loadAddresses).toHaveBeenCalledTimes(1));
    // Give the rejection's .catch a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(setAddressMap).not.toHaveBeenCalled();
  });

  it("only loads once across re-renders", async () => {
    loadAddresses.mockResolvedValue({});
    const { useHydrateAddressMap } = await import("./useHydrateAddressMap");
    const { rerender } = renderHook(() => useHydrateAddressMap());
    rerender();
    rerender();
    await waitFor(() => expect(setAddressMap).toHaveBeenCalledTimes(1));
    expect(loadAddresses).toHaveBeenCalledTimes(1);
  });
});
