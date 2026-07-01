// Unit coverage for the canonical chain registry shared across the build
// pipeline (build-graph normalizeChain, multisig chain headers, address-enrich
// CHAIN_ID). Guards the specific→generic ordering and the future-chain collapse.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { normalizeChainLabel, CHAIN_ID } from "../scripts/lib/chains.mjs";

describe("normalizeChainLabel", () => {
  it("defaults empty / unknown labels to ethereum", () => {
    expect(normalizeChainLabel("")).toBe("ethereum");
    expect(normalizeChainLabel(undefined)).toBe("ethereum");
    expect(normalizeChainLabel("SomethingWeird")).toBe("ethereum");
  });

  it("resolves the specific chain when a label also contains 'mainnet'", () => {
    expect(normalizeChainLabel("Base Mainnet")).toBe("base");
    expect(normalizeChainLabel("Mainnet")).toBe("ethereum");
  });

  it("maps the known chains and their aliases", () => {
    expect(normalizeChainLabel("Arbitrum One")).toBe("arbitrum");
    expect(normalizeChainLabel("Optimism")).toBe("optimism");
    expect(normalizeChainLabel("avax")).toBe("avalanche");
    expect(normalizeChainLabel("Solana")).toBe("solana");
    expect(normalizeChainLabel("Gnosis")).toBe("gnosis");
  });

  it("collapses future/testnet chains with no explorer to ethereum", () => {
    for (const c of ["Plasma", "Monad", "Plume"]) {
      expect(normalizeChainLabel(c)).toBe("ethereum");
    }
  });
});

describe("CHAIN_ID", () => {
  it("maps EVM chains to their network ids and omits non-EVM solana", () => {
    expect(CHAIN_ID.ethereum).toBe(1);
    expect(CHAIN_ID.base).toBe(8453);
    expect(CHAIN_ID.arbitrum).toBe(42161);
    expect(CHAIN_ID.solana).toBeUndefined();
  });
});
