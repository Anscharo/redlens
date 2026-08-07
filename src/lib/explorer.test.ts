import { describe, it, expect } from "vitest";
import { explorerUrl, EXPLORER } from "./explorer";

const EVM = "0x1234567890abcdef1234567890abcdef12345678";
const SOL = "So11111111111111111111111111111111111111112";

describe("explorerUrl", () => {
  it("prefers a precomputed url from the address map", () => {
    const addrMap = { [EVM.toLowerCase()]: { explorerUrl: "https://custom/x" } };
    expect(explorerUrl(EVM, { addrMap })).toBe("https://custom/x");
  });

  it("falls back to a chain hint over the address map when the map lacks the entry", () => {
    expect(explorerUrl(EVM, { chain: "Base" })).toBe(EXPLORER.base + EVM);
    expect(explorerUrl(EVM, { chain: "Arbitrum One" })).toBe(EXPLORER.arbitrum + EVM);
  });

  it("infers solana from the address shape when no hint is given", () => {
    expect(explorerUrl(SOL)).toBe(EXPLORER.solana + SOL);
  });

  it("defaults EVM-shaped addresses to ethereum", () => {
    expect(explorerUrl(EVM)).toBe(EXPLORER.ethereum + EVM);
  });

  it("lets the address map outrank a hint that names a different chain", () => {
    // The real case: the "Grove Arbitrum Governance Relay Receiver" is deployed
    // on Robinhood Chain. Its *name* is not evidence of where it lives, so the
    // resolved map must win over the name hint — otherwise the address links to
    // arbiscan, where it has no code at all.
    const addrMap = { [EVM.toLowerCase()]: { explorerUrl: EXPLORER.robinhood + EVM } };
    expect(
      explorerUrl(EVM, { chain: ["assetRecoveryAddress", "Grove Arbitrum Governance Relay Receiver"], addrMap }),
    ).toBe(EXPLORER.robinhood + EVM);
  });

  it("matches chain hints on word boundaries, not substrings", () => {
    // "Database"/"Baserate" must not read as base, and "Solanaceae" not as solana.
    expect(explorerUrl(EVM, { chain: "Database Registry" })).toBe(EXPLORER.ethereum + EVM);
    expect(explorerUrl(EVM, { chain: "Baserate Parameters" })).toBe(EXPLORER.ethereum + EVM);
    // A real hint still resolves, including when punctuation forms the boundary.
    expect(explorerUrl(EVM, { chain: "Token Address (Base)" })).toBe(EXPLORER.base + EVM);
    expect(explorerUrl(EVM, { chain: "arbitrum-one" })).toBe(EXPLORER.arbitrum + EVM);
  });

  it("accepts a priority list of hints and uses the first one that names a chain", () => {
    // Real Spark data shape: a param key naming the token's own chain
    // ("Token Address (Avalanche)") on an instance whose name says the
    // instance's home chain is Ethereum Mainnet — the key must win (RD1).
    expect(
      explorerUrl(EVM, { chain: ["Token Address (Avalanche)", "Ethereum Mainnet - Galaxy Arch CLOs"] }),
    ).toBe(EXPLORER.avalanche + EVM);
    // And the inverse: a generic key falls back to the instance-name hint.
    expect(
      explorerUrl(EVM, { chain: [undefined, "Base - Morpho Blue USDC ERC4626 Vault"] }),
    ).toBe(EXPLORER.base + EVM);
  });
});
