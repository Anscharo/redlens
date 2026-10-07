// The Radar PAU helpers: deployment order, amount scaling (the decimals rule
// and the unlimited sentinel), and the instance label each rate-limit key gets.
import { describe, expect, it } from "vitest";
import type { StoredPauSnapshot } from "./pau.ts";
import { instanceKeyIndex, labelOnChain, formatAmount, formatPerDay, inferDecimals, snapshotsForPrime } from "./pauView.ts";

const snap = (prime: string, chain: string, kind: "monolithic" | "diamond") =>
  ({ deployment: `${prime}:${chain}:${kind}`, prime, primeName: "P", chain, kind, contracts: [], fetchedAt: "" }) as StoredPauSnapshot;

describe("snapshotsForPrime", () => {
  it("keeps the prime's deployments, Ethereum first, monolithic before diamond", () => {
    const res = { deployments: [snap("p", "base", "monolithic"), snap("q", "ethereum", "monolithic"), snap("p", "ethereum", "diamond"), snap("p", "arbitrum", "diamond"), snap("p", "ethereum", "monolithic")] };
    expect(snapshotsForPrime(res, "p").map((s) => `${s.chain}:${s.kind}`)).toEqual(["ethereum:monolithic", "ethereum:diamond", "arbitrum:diamond", "base:monolithic"]);
  });
});

describe("amounts", () => {
  it("reads a limit of at least 1e18 raw units as 18 decimals, anything smaller as 6", () => {
    expect(inferDecimals("25000000000000")).toBe(6); // 25M USDC
    expect(inferDecimals("1000000000000000000000000000")).toBe(18); // 1B USDS
  });
  it("formats compactly, with the max uint256 sentinel as unlimited", () => {
    expect(formatAmount("25000000000000", 6)).toBe("25M");
    expect(formatAmount("1500000000000000000000000000", 18)).toBe("1.5B");
    expect(formatAmount("1234500", 6)).toBe("1.23");
    expect(formatAmount(((1n << 256n) - 1n).toString(), 18)).toBe("unlimited");
  });
  it("turns a per-second slope into an amount per day", () => {
    expect(formatPerDay("289351851", 6)).toBe("25M");
    expect(formatPerDay("0", 18)).toBe("0");
  });
});

describe("instanceKeyIndex", () => {
  const H1 = "0x" + "ab".repeat(32);
  const H2 = "0x" + "CD".repeat(32);
  const inst = (displayName: string, params: [string, string, string | null][]) => ({
    displayName,
    signalParams: params.map(([key, value, srcDocId]) => ({ key, value, srcDocId })),
  });
  const index = instanceKeyIndex([
    inst("SparkLend ETH", [["Inflow Rate Limit ID", H1, "d1"], ["Token Address", "0x" + "1".repeat(40), "d2"]]),
    inst("Curve AUSD/USDC", [["Outflow RateLimitID (AUSD)", ` ${H2} `, null], ["Inflow RateLimitID", H1, "d3"]]),
  ]);
  it("labels a key with its instance and what the parameter says it limits", () => {
    expect(index.get(H1)).toEqual([
      { docId: "d1", label: "SparkLend ETH · Inflow" },
      { docId: "d3", label: "Curve AUSD/USDC · Inflow" },
    ]);
  });
  it("lowercases and trims the key, keeps a missing source doc as null, and skips non-key values", () => {
    expect(index.get(H2.toLowerCase())).toEqual([{ docId: null, label: "Curve AUSD/USDC · Outflow (AUSD)" }]);
    expect(index.size).toBe(2);
  });
});

describe("labelOnChain", () => {
  it("drops an instance prefix naming the deployment's chain and keeps any other", () => {
    expect(labelOnChain("Ethereum Mainnet - Aave Core v3 USDC · Inflow", "ethereum")).toBe("Aave Core v3 USDC · Inflow");
    expect(labelOnChain("Base - Spark Savings · Inflow", "ethereum")).toBe("Base - Spark Savings · Inflow");
    expect(labelOnChain("USDS Mint", "ethereum")).toBe("USDS Mint");
  });
});
