// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import type { AtlasNode, AddressInfo } from "@/types";
import type { BalancesResponse } from "@/lib/balances";

const node = (over: Partial<AtlasNode> & { id: string; doc_no: string }): AtlasNode => ({
  title: "T",
  type: "Core",
  depth: 3,
  parentId: null,
  content: "",
  order: 0,
  addressRefs: [],
  ...over,
});

const info = (over: Partial<AddressInfo> = {}): AddressInfo => ({
  chain: "ethereum",
  chains: [over.chain ?? "ethereum"],
  explorerUrl: "https://etherscan.io/address/0x",
  label: null,
  isContract: false,
  isProxy: false,
  roles: [],
  aliases: [],
  expectedTokens: [],
  ...over,
});

const docs: Record<string, AtlasNode> = {
  d1: node({ id: "d1", doc_no: "A.1", title: "Alice Doc", addressRefs: ["0xAAA0000000000000000000000000000000000001"] }),
  d2: node({ id: "d2", doc_no: "A.2", title: "Pause Proxy Doc", content: "See MCD_PAUSE_PROXY for details." }),
};

const addrMap: Record<string, AddressInfo> = {
  "0xaaa0000000000000000000000000000000000001": info({ entityLabel: "Alice Corp", isContract: false }),
  "0xbbb0000000000000000000000000000000000002": info({
    chainlogId: "MCD_PAUSE_PROXY",
    isContract: true,
    isProxy: true,
    implementation: "0xccc0000000000000000000000000000000000003",
  }),
  "0xddd0000000000000000000000000000000000004": info({ roles: ["multisig"], isContract: true }),
};

let balancesImpl: () => Promise<BalancesResponse> = () =>
  Promise.resolve({
    lastCheckedAt: "2026-08-01T00:00:00.000Z",
    nextRefreshAt: "2020-01-01T00:00:00.000Z", // in the past — refresh allowed
    refreshed: false,
    addresses: {
      "0xaaa0000000000000000000000000000000000001|ethereum": {
        chain: "ethereum",
        checkedAt: "2026-08-01T00:00:00.000Z",
        hasCode: null,
        balances: {
          ETH: { raw: "1000000000000000000", decimals: 18 },
          DAI: { raw: "2500000", decimals: 6 },
        },
      },
    },
  });
let refreshImpl: () => Promise<BalancesResponse> = balancesImpl;

vi.mock("../../lib/docs", () => ({ loadDocs: () => Promise.resolve(docs) }));
vi.mock("../../lib/addresses", () => ({ loadAddresses: () => Promise.resolve(addrMap) }));
vi.mock("@/lib/balances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/balances")>();
  return {
    ...actual,
    loadBalances: () => balancesImpl(),
    requestBalancesRefresh: () => refreshImpl(),
  };
});

import { OnchainAddressesReport } from "./OnchainAddressesReport";

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
  balancesImpl = () =>
    Promise.resolve({
      lastCheckedAt: "2026-08-01T00:00:00.000Z",
      nextRefreshAt: "2020-01-01T00:00:00.000Z",
      refreshed: false,
      addresses: {
        "0xaaa0000000000000000000000000000000000001|ethereum": {
          chain: "ethereum",
          checkedAt: "2026-08-01T00:00:00.000Z",
          hasCode: null,
          balances: {
            ETH: { raw: "1000000000000000000", decimals: 18 },
            DAI: { raw: "2500000", decimals: 6 },
          },
        },
      },
    });
  refreshImpl = balancesImpl;
  vi.restoreAllMocks();
});

describe("OnchainAddressesReport", () => {
  it("shows a loading state, then renders rows with type pills, balances, and docs", async () => {
    render(<OnchainAddressesReport query="" mode="broad" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    expect(await screen.findByText("3 addresses", { selector: "p.text-xs" })).toBeInTheDocument();
    // Type pills for the three classifications present.
    expect(screen.getByRole("button", { name: "EOA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sky Internal Contract" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Multisig" })).toBeInTheDocument();
    // Primary balance (ETH) + folded "other" token (DAI) for the priced address.
    expect(screen.getByText("1.00")).toBeInTheDocument(); // ETH compact amount
    expect(screen.getByText("DAI 2.50")).toBeInTheDocument();
    // Proxy implementation link renders shortened.
    expect(screen.getByTitle("implementation: 0xccc0000000000000000000000000000000000003")).toBeInTheDocument();
    // Address doc mention (via address, no chainlog-name tag) vs chainlog-name-only mention.
    expect(screen.getByTitle("A.1 — Alice Doc [Core]")).toBeInTheDocument();
    expect(screen.getByTitle("A.2 — Pause Proxy Doc [Core]")).toBeInTheDocument();
    expect(screen.getAllByText("chainlog name").length).toBeGreaterThan(0);
    // The multisig address has no mentioning doc.
    expect(screen.getByText("(no mentions)")).toBeInTheDocument();
  });

  it("filters rows by chain and type pills", async () => {
    render(<OnchainAddressesReport query="" mode="broad" />);
    await screen.findByText("3 addresses", { selector: "p.text-xs" });

    fireEvent.click(screen.getByRole("button", { name: "Multisig" }));
    expect(screen.getByText("1 addresses", { selector: "p.text-xs" })).toBeInTheDocument();
    const tbody = document.querySelector("tbody") as HTMLElement;
    expect(within(tbody).queryByText("EOA")).not.toBeInTheDocument();

    // Toggling the same pill off restores all rows.
    fireEvent.click(screen.getByRole("button", { name: "Multisig" }));
    expect(screen.getByText("3 addresses", { selector: "p.text-xs" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ethereum" }));
    expect(screen.getByText("3 addresses", { selector: "p.text-xs" })).toBeInTheDocument(); // every fixture row is on ethereum
  });

  it("filters by the query prop and shows NoRowsMatch when nothing matches", async () => {
    render(<OnchainAddressesReport query="alice" mode="broad" />);
    await screen.findByTitle("A.1 — Alice Doc [Core]");
    expect(screen.queryByTitle("A.2 — Pause Proxy Doc [Core]")).not.toBeInTheDocument();

    cleanup();
    render(<OnchainAddressesReport query="zzz-no-match" mode="broad" />);
    expect(await screen.findByText(/No rows match/)).toBeInTheDocument();
  });

  it("disables Refresh balances during the cooldown window and enables it once it can run", async () => {
    balancesImpl = () =>
      Promise.resolve({
        lastCheckedAt: "2026-08-05T09:00:00.000Z",
        nextRefreshAt: new Date(Date.now() + 3_600_000).toISOString(), // an hour out — cooldown active
        refreshed: false,
        addresses: {},
      });
    render(<OnchainAddressesReport query="" mode="broad" />);
    const btn = await screen.findByRole("button", { name: "Refresh balances" });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/balances updated/)).toBeInTheDocument();
  });

  it("runs a refresh on click, disabling the button meanwhile and updating the balances line", async () => {
    let resolveRefresh!: (v: BalancesResponse) => void;
    refreshImpl = () => new Promise((resolve) => { resolveRefresh = resolve; });

    render(<OnchainAddressesReport query="" mode="broad" />);
    const btn = await screen.findByRole("button", { name: "Refresh balances" });
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    expect(await screen.findByText("Refreshing balances…")).toBeInTheDocument();

    resolveRefresh({
      lastCheckedAt: "2026-08-05T10:00:00.000Z",
      nextRefreshAt: new Date(Date.now() + 3_600_000).toISOString(),
      refreshed: true,
      addresses: {},
    });
    expect(await screen.findByRole("button", { name: "Refresh balances" })).toBeInTheDocument();
    expect(screen.getByText(/balances updated/)).toBeInTheDocument();
  });

  it("shows a balances-unavailable message when the refresh request fails", async () => {
    refreshImpl = () => Promise.reject(new Error("network down"));
    render(<OnchainAddressesReport query="" mode="broad" />);
    const btn = await screen.findByRole("button", { name: "Refresh balances" });
    fireEvent.click(btn);
    expect(await screen.findByText("balances unavailable")).toBeInTheDocument();
  });

  it("builds and downloads a CSV when the download button is clicked", async () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    render(<OnchainAddressesReport query="" mode="broad" />);
    await screen.findByText("3 addresses", { selector: "p.text-xs" });
    fireEvent.click(screen.getByText("Download full report"));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });
});
