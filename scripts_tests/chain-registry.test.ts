// The chain registry is the single source of truth: src/data/chain-registry.json
// feeds CHAINS + FUTURE_TO_ETHEREUM (chains.mjs), CHAIN_HINTS
// (address-chains.mjs), EXPLORER (explorer.ts) and NATIVE_TOKEN (tokens.ts).
//
// These were four hand-kept lists, and every omission failed silently — a
// missing explorer sent addresses to another chain's block explorer, a missing
// prose hint meant the chain could never be attributed, a missing native token
// made the balances fetcher skip it. The derivation is what makes those
// failures impossible, so it gets tested directly rather than trusted.

import { describe, it, expect } from "vitest";
import registry from "../src/data/chain-registry.json";
import { CHAINS, FUTURE_TO_ETHEREUM, CHAIN_ID, CHAIN_RPC } from "../scripts/lib/chains.mjs";
import { CHAIN_HINTS } from "../scripts/lib/address-chains.mjs";
import { EXPLORER } from "../src/lib/explorer";
import { NATIVE_TOKEN } from "../src/lib/tokens";

const keys = registry.chains.map((c) => c.chain);
const evm = registry.chains.filter((c) => c.chain !== "solana");

describe("every registry entry is complete", () => {
  it.each(evm.map((c) => c.chain))("%s has the fields whose absence fails silently", (key) => {
    const c = registry.chains.find((x) => x.chain === key)!;
    expect(c.chainId, "no chainId → collapses to ethereum").toBeTypeOf("number");
    expect(c.rpcUrl, "no rpcUrl → cannot be queried on-chain").toMatch(/^https:\/\//);
    expect(c.explorer, "no explorer → links to another chain's explorer").toMatch(/^https:\/\/.*\/$/);
    expect(c.proseHints?.length, "no proseHints → prose is never attributed to it").toBeGreaterThan(0);
    expect(c.nativeToken?.symbol, "no nativeToken → balances fetcher skips it").toBeTruthy();
    expect(c.aliases.length).toBeGreaterThan(0);
  });

  it("keeps solana's deliberate omissions", () => {
    const solana = registry.chains.find((c) => c.chain === "solana")!;
    // Each of these would push solana down an EVM-only path.
    expect(solana.chainId).toBeUndefined();
    expect(solana.rpcUrl).toBeUndefined();
    expect(solana.nativeToken).toBeUndefined();
    expect(solana.proseHints).toEqual([]);
    expect(solana.solanaRpcUrl).toMatch(/^https:\/\//);
  });

  it("gives any etherscan-less chain a blockscout fallback", () => {
    for (const c of registry.chains.filter((x) => x.etherscan === false)) {
      expect(c.blockscoutApi, `${c.chain} has no contract-metadata source at all`).toMatch(/^https:\/\//);
    }
  });

  it("has no duplicate chain keys", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never lists a registered chain as deferred", () => {
    for (const d of registry.deferred) expect(keys).not.toContain(d);
  });
});

describe("the four structures derive from the registry", () => {
  it("CHAINS covers every entry, ethereum last", () => {
    expect(CHAINS.map((c) => c.chain)).toEqual(keys);
    // Load-bearing: label matching is a substring test, so ethereum's "mainnet"
    // alias must not swallow "Base Mainnet".
    expect(CHAINS.at(-1)?.chain).toBe("ethereum");
  });

  it("CHAIN_HINTS covers every EVM chain, ethereum FIRST", () => {
    // The opposite ordering to CHAINS, deliberately: an "ethereum mainnet"
    // context in prose should win.
    expect(CHAIN_HINTS[0].chain).toBe("ethereum");
    expect(CHAIN_HINTS.map((h) => h.chain).sort()).toEqual(
      registry.chains.filter((c) => c.proseHints?.length).map((c) => c.chain).sort(),
    );
  });

  it("compiles proseHintExclusions into a negative lookahead", () => {
    const gnosis = CHAIN_HINTS.find((h) => h.chain === "gnosis")!;
    // "Gnosis Safe" is the multisig, on any chain — not Gnosis Chain.
    expect(gnosis.patterns.some((p: RegExp) => p.test("Gnosis Safe"))).toBe(false);
    expect(gnosis.patterns.some((p: RegExp) => p.test("Gnosis Chain"))).toBe(true);
    expect(gnosis.patterns.some((p: RegExp) => p.test("xDai"))).toBe(true);
  });

  it("EXPLORER and NATIVE_TOKEN match the registry exactly", () => {
    expect(Object.keys(EXPLORER).sort()).toEqual(
      registry.chains.filter((c) => c.explorer).map((c) => c.chain).sort(),
    );
    expect(Object.keys(NATIVE_TOKEN).sort()).toEqual(
      registry.chains.filter((c) => c.nativeToken).map((c) => c.chain).sort(),
    );
    // Solana must stay out of NATIVE_TOKEN — its presence is what gates the
    // EVM multicall path.
    expect(NATIVE_TOKEN.solana).toBeUndefined();
  });

  it("CHAIN_ID and CHAIN_RPC skip the non-EVM chain", () => {
    expect(Object.keys(CHAIN_ID).sort()).toEqual(evm.map((c) => c.chain).sort());
    expect(Object.keys(CHAIN_RPC).sort()).toEqual(evm.map((c) => c.chain).sort());
  });

  it("FUTURE_TO_ETHEREUM is the registry's deferred list", () => {
    expect(FUTURE_TO_ETHEREUM).toEqual(registry.deferred);
  });
});

describe("the chains promoted out of deferred", () => {
  // Plasma, Monad and Plume used to collapse to ethereum, which linked 11
  // atlas addresses — including the Plasma SkyLink Freezer Multisig — to
  // etherscan.io.
  it.each([
    ["plasma", 9745, "XPL"],
    ["monad", 143, "MON"],
    ["plume", 98866, "PLUME"],
  ])("%s is a first-class chain with its own explorer", (key, chainId, symbol) => {
    expect(CHAIN_ID[key]).toBe(chainId);
    expect(NATIVE_TOKEN[key].symbol).toBe(symbol);
    expect(EXPLORER[key]).toMatch(/^https:\/\//);
    expect(EXPLORER[key]).not.toContain("etherscan.io");
    expect(FUTURE_TO_ETHEREUM).not.toContain(key);
  });
});
