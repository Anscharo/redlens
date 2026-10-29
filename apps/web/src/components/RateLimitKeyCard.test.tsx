// @vitest-environment jsdom
// RateLimitKeyCard: each holder's heading tells it apart from the card's other
// holders — by controller kind across a prime's two deployments on one chain,
// and by contract where one deployment has two RateLimits holding the key.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { LiveRateLimit, StoredPauSnapshot } from "@/lib/pau";
import type { KeyHolder } from "@/lib/pauKeyHolders";
import { RateLimitKeyCard } from "./RateLimitKeyCard";

const KEY = "0x" + "ab".repeat(32);
const RL1 = "0x" + "1".repeat(40);
const RL2 = "0x" + "2".repeat(40);
const limit: LiveRateLimit = {
  key: KEY,
  configured: { maxAmount: "1000000", slope: "0" },
  setAt: { block: 1, time: "2026-01-01T00:00:00Z", tx: "0x" },
  changes: 1,
  data: { maxAmount: "1000000", slope: "0", lastAmount: "0", lastUpdated: "0" },
  available: "1000000",
  unit: { decimals: 6, symbol: "USDC", source: "constant" },
};
const snap = (kind: "monolithic" | "diamond") =>
  ({ deployment: `grove:ethereum:${kind}`, prime: "g", primeName: "Grove", chain: "ethereum", kind, contracts: [], fetchedAt: "2026-10-29T00:00:00Z" }) as StoredPauSnapshot;
const holder = (kind: "monolithic" | "diamond", contract: string): KeyHolder => ({ snap: snap(kind), contract, limit });

const headings = (holders: KeyHolder[]) =>
  [...render(<RateLimitKeyCard holders={holders} />).container.querySelectorAll("[data-chain] > div:first-child")].map((d) => d.textContent);

afterEach(cleanup);

describe("RateLimitKeyCard headings", () => {
  it("names only the prime and chain for a single holder", () => {
    expect(headings([holder("diamond", RL1)])).toEqual(["Grove · Ethereum"]);
  });
  it("adds the controller kind when the prime holds the key on two deployments of one chain", () => {
    expect(headings([holder("monolithic", RL1), holder("diamond", RL2)])).toEqual([
      "Grove · Ethereum · monolithic ALM Controller",
      "Grove · Ethereum · Diamond PAU",
    ]);
  });
  it("adds the RateLimits contract when two contracts of one deployment hold the key", () => {
    expect(headings([holder("diamond", RL1), holder("diamond", RL2)])).toEqual([
      "Grove · Ethereum · 0x1111…1111",
      "Grove · Ethereum · 0x2222…2222",
    ]);
  });
});
