// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { setAddressMap } from "../lib/addressMap";
import { makeAddressInfo } from "../test/fixtures";
import { AddressTooltip } from "./AddressTooltip";

const EVM = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

const loadBalancesCached = vi.fn();
vi.mock("../lib/balances", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBalancesCached: () => loadBalancesCached(),
}));

beforeEach(() => {
  vi.useFakeTimers();
  loadBalancesCached.mockReset();
});
afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setAddressMap({});
});

async function hover(text: string) {
  fireEvent.mouseEnter(screen.getByText(text));
  await act(async () => {
    vi.advanceTimersByTime(800);
  });
  // Flush the microtask queue so loadBalancesCached()'s resolved promise
  // (fake timers don't drive microtasks) lands before assertions.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("AddressTooltip", () => {
  it("shows the resolved name and only non-zero balances on hover", async () => {
    setAddressMap({ [EVM]: makeAddressInfo({ chainlogId: "Test Multisig" }) });
    loadBalancesCached.mockResolvedValue({
      lastCheckedAt: null,
      nextRefreshAt: null,
      refreshed: false,
      addresses: {
        [`${EVM}|ethereum`]: {
          chain: "ethereum",
          checkedAt: null,
          hasCode: null,
          balances: {
            ETH: { raw: "2500000000000000000", decimals: 18 },
            USDS: { raw: "0", decimals: 18 },
          },
        },
      },
    });

    render(
      <AddressTooltip address={EVM}>
        <a href="#">{EVM}</a>
      </AddressTooltip>,
    );
    await hover(EVM);

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Test Multisig");
    expect(tip).toHaveTextContent("ETH");
    expect(tip).toHaveTextContent("2.50");
    expect(tip).not.toHaveTextContent("USDS");
  });

  it("falls back to a shortened address and shows no balance rows when nothing is known", async () => {
    loadBalancesCached.mockResolvedValue({
      lastCheckedAt: null,
      nextRefreshAt: null,
      refreshed: false,
      addresses: {},
    });

    render(
      <AddressTooltip address={EVM}>
        <a href="#">{EVM}</a>
      </AddressTooltip>,
    );
    await hover(EVM);

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent(`${EVM.slice(0, 6)}…${EVM.slice(-4)}`);
    expect(tip).not.toHaveTextContent("ETH");
  });

  it("still shows the name when the balances fetch fails", async () => {
    setAddressMap({ [EVM]: makeAddressInfo({ chainlogId: "Test Multisig" }) });
    loadBalancesCached.mockRejectedValue(new Error("network down"));

    render(
      <AddressTooltip address={EVM}>
        <a href="#">{EVM}</a>
      </AddressTooltip>,
    );
    await hover(EVM);

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Test Multisig");
  });

  it("shows a loading state before the balances fetch resolves, then replaces it", async () => {
    setAddressMap({ [EVM]: makeAddressInfo({ chainlogId: "Test Multisig" }) });
    let resolveFetch!: (v: unknown) => void;
    loadBalancesCached.mockReturnValue(new Promise((r) => { resolveFetch = r; }));

    render(
      <AddressTooltip address={EVM}>
        <a href="#">{EVM}</a>
      </AddressTooltip>,
    );
    fireEvent.mouseEnter(screen.getByText(EVM));
    await act(async () => {
      vi.advanceTimersByTime(800);
    });

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Test Multisig");
    expect(tip).toHaveTextContent("Loading balances");

    await act(async () => {
      resolveFetch({
        lastCheckedAt: null,
        nextRefreshAt: null,
        refreshed: false,
        addresses: {
          [`${EVM}|ethereum`]: {
            chain: "ethereum",
            checkedAt: null,
            hasCode: null,
            balances: { ETH: { raw: "1000000000000000000", decimals: 18 } },
          },
        },
      });
    });

    expect(tip).not.toHaveTextContent("Loading balances");
    expect(tip).toHaveTextContent("ETH");
  });

  it("tags each balance row with its chain for a multi-chain address", async () => {
    setAddressMap({ [EVM]: makeAddressInfo({ chainlogId: "ALM Proxy", chains: ["ethereum", "base"] }) });
    loadBalancesCached.mockResolvedValue({
      lastCheckedAt: null,
      nextRefreshAt: null,
      refreshed: false,
      addresses: {
        [`${EVM}|ethereum`]: {
          chain: "ethereum",
          checkedAt: null,
          hasCode: null,
          balances: { ETH: { raw: "1000000000000000000", decimals: 18 } },
        },
        [`${EVM}|base`]: {
          chain: "base",
          checkedAt: null,
          hasCode: null,
          balances: { ETH: { raw: "2000000000000000000", decimals: 18 } },
        },
      },
    });

    render(
      <AddressTooltip address={EVM}>
        <a href="#">{EVM}</a>
      </AddressTooltip>,
    );
    await hover(EVM);

    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("ETH (ethereum)");
    expect(tip).toHaveTextContent("ETH (base)");
  });
});
