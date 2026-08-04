// Unit coverage for the canonical chain registry shared across the build
// pipeline (build-graph normalizeChain, multisig chain headers, address-enrich
// CHAIN_ID). Guards the specific→generic ordering and the future-chain collapse.

import { describe, it, expect, vi } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import {
  normalizeChainLabel,
  classifyChainLabel,
  CHAIN_ID,
  CHAIN_RPC,
  CHAIN_BLOCKSCOUT,
  CHAIN_SUPPORTS_ETHERSCAN,
} from "../scripts/lib/chains.mjs";

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

describe("classifyChainLabel", () => {
  it("classifies empty / blank / null as empty → ethereum", () => {
    expect(classifyChainLabel("")).toEqual({ kind: "empty", chain: "ethereum" });
    expect(classifyChainLabel("   ")).toEqual({ kind: "empty", chain: "ethereum" });
    expect(classifyChainLabel(null)).toEqual({ kind: "empty", chain: "ethereum" });
  });
  it("classifies a registered chain (including robinhood) as known", () => {
    expect(classifyChainLabel("Base Mainnet")).toMatchObject({ kind: "known", chain: "base" });
    expect(classifyChainLabel("Robinhood Chain")).toMatchObject({ kind: "known", chain: "robinhood" });
  });
  it("classifies FUTURE_TO_ETHEREUM chains as deferred → ethereum", () => {
    expect(classifyChainLabel("Plume Network")).toMatchObject({ kind: "deferred", chain: "ethereum", deferred: "plume" });
  });
  it("classifies an unrecognized non-empty label as unknown → ethereum", () => {
    expect(classifyChainLabel("Wonderland")).toMatchObject({ kind: "unknown", chain: "ethereum", raw: "Wonderland" });
  });
});

describe("normalizeChainLabel warnCtx", () => {
  it("warns once for an unknown label with warnCtx, but not for known/deferred", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normalizeChainLabel("Wonderland", "test-ctx")).toBe("ethereum");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(normalizeChainLabel("Plume", "test-ctx")).toBe("ethereum");
    expect(normalizeChainLabel("Base", "test-ctx")).toBe("base");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("CHAIN_RPC", () => {
  it("has an https rpc for every EVM chain and none for solana", () => {
    expect(CHAIN_RPC.ethereum).toMatch(/^https:\/\//);
    expect(CHAIN_RPC.robinhood).toMatch(/^https:\/\//);
    expect(CHAIN_RPC.solana).toBeUndefined();
  });
});

describe("CHAIN_BLOCKSCOUT", () => {
  it("configures a Blockscout API for robinhood (primary) and ethereum (backup)", () => {
    expect(CHAIN_BLOCKSCOUT.robinhood).toMatch(/^https:\/\/.*blockscout/);
    expect(CHAIN_BLOCKSCOUT.ethereum).toMatch(/^https:\/\/.*blockscout/);
    // chains without a Blockscout instance are simply absent
    expect(CHAIN_BLOCKSCOUT.base).toBeUndefined();
  });
});

describe("CHAIN_SUPPORTS_ETHERSCAN", () => {
  it("includes Etherscan-v2 chains but not robinhood (chain 4663 is unsupported) or solana", () => {
    expect(CHAIN_SUPPORTS_ETHERSCAN.has("ethereum")).toBe(true);
    expect(CHAIN_SUPPORTS_ETHERSCAN.has("base")).toBe(true);
    expect(CHAIN_SUPPORTS_ETHERSCAN.has("robinhood")).toBe(false);
    expect(CHAIN_SUPPORTS_ETHERSCAN.has("solana")).toBe(false);
  });
});
