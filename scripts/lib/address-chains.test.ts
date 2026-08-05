import { describe, it, expect } from "vitest";
import { detectChain, detectChainOrNull, chainFromLabel } from "./address-chains.mjs";

// Helper: place the address in `text` and detect at its offset, the way the
// build passes call it.
function chainOf(text: string, addr = "0xa02eC279eEA9E56F4E14449a07C5ca5FDAAdc51d") {
  const i = text.indexOf(addr);
  if (i === -1) throw new Error("address not present in fixture text");
  return detectChain(text, i);
}

const A = "0xa02eC279eEA9E56F4E14449a07C5ca5FDAAdc51d";
const B = "0x10E6593CDda8c58a1d0f14C5164B376352a55f2F";

describe("detectChain — explicit 'on <chain> is' clause", () => {
  it("takes the chain from the clause, not from a chain named in the entity name", () => {
    // Regression: the entity is named "Grove Arbitrum ... receiver" but it lives
    // on Robinhood Chain. Registry-order keyword scanning returned arbitrum.
    expect(
      chainOf(`The address of the Grove Arbitrum governance relay receiver on Robinhood Chain is: \`${A}\`.`),
    ).toBe("robinhood");
  });

  it("matches through a long entity name between 'address' and 'on'", () => {
    expect(chainOf(`The address of the Some Very Long Contract Name on Optimism is: \`${A}\`.`)).toBe("optimism");
  });

  it("tolerates the ':' and backtick the atlas writes between 'is' and the address", () => {
    expect(chainOf(`The address of the thing on Base is: \`${A}\``)).toBe("base");
    expect(chainOf(`The address of the thing on Base is ${A}`)).toBe("base");
  });

  it("uses the nearest clause when a sentence contains two", () => {
    expect(chainOf(`The bridge on Arbitrum has a receiver on Robinhood Chain is: \`${A}\``)).toBe("robinhood");
  });

  it("resolves a multi-chain enumeration to ethereum, the canonical chain", () => {
    // One address deployed to all three — the report holds a single chain, and
    // registry order puts ethereum first.
    expect(
      chainOf(`The address of the Prime Relayer Multisig on the Ethereum Mainnet, Base, and Arbitrum is \`${A}\``),
    ).toBe("ethereum");
  });

  it("ignores a clause naming no known chain and falls through to the keyword scan", () => {
    expect(chainOf(`Deployed to Base. The address of the widget on the ledger is \`${A}\``)).toBe("base");
  });
});

describe("detectChain — a preceding address ends the previous chain's context", () => {
  it("attributes each row of a per-chain list to its own chain", () => {
    const list = `The value for each chain is: - Ethereum Mainnet - \`${B}\` - Arbitrum - \`${A}\``;
    expect(chainOf(list, A)).toBe("arbitrum");
  });

  it("does not let a previous sentence's chain leak past its own address", () => {
    const two = `The address of SPK on the Ethereum Mainnet is \`${B}\`. The address of SPK on Base is \`${A}\`.`;
    expect(chainOf(two, A)).toBe("base");
  });

  it("still uses the wider context when trimming would leave no chain at all", () => {
    // "Base" sits before the first address, so the trimmed segment names
    // nothing — the untrimmed window must still be consulted.
    expect(chainOf(`On Base: \`${B}\` and \`${A}\``, A)).toBe("base");
  });
});

describe("detectChain — fallback", () => {
  it("defaults to ethereum when nothing names a chain", () => {
    expect(chainOf(`The address of the ALM_PROXY contract is: \`${A}\``)).toBe("ethereum");
  });

  it("detectChainOrNull reports the absence of a signal instead of defaulting", () => {
    const text = `The address of the ALM_PROXY contract is: \`${A}\``;
    expect(detectChainOrNull(text, text.indexOf(A))).toBeNull();
    expect(detectChain(text, text.indexOf(A))).toBe("ethereum");
  });
});

describe("chainFromLabel", () => {
  it("reads a chain out of a doc-title parenthetical", () => {
    expect(chainFromLabel("ALM Proxy (Optimism) Contract")).toBe("optimism");
    expect(chainFromLabel("ALM Controller (ForeignController Base) Contract Address")).toBe("base");
    expect(chainFromLabel("ALM Freezer Multisig (Robinhood Chain) Address")).toBe("robinhood");
  });

  it("reads a bare per-chain grouping heading", () => {
    expect(chainFromLabel("Base")).toBe("base");
    expect(chainFromLabel("Robinhood Chain")).toBe("robinhood");
  });

  it("prefers the specific chain over ethereum in a '<Chain> Mainnet' label", () => {
    // Opposite ordering to the prose scan: a label is deliberate, so
    // "Base Mainnet" is base — not ethereum via the \\bmainnet\\b hint.
    expect(chainFromLabel("Base Mainnet - Fluid sUSDS ERC4626 Vault")).toBe("base");
    expect(chainFromLabel("Ethereum Mainnet - Morpho USDS Instance")).toBe("ethereum");
  });

  it("resolves a deferred chain to ethereum so an ancestor walk stops there", () => {
    expect(chainFromLabel("Plume")).toBe("ethereum");
    expect(chainFromLabel("Plasma")).toBe("ethereum");
  });

  it("returns null for a label naming no chain", () => {
    expect(chainFromLabel("Monolithic ALM Contracts")).toBeNull();
    expect(chainFromLabel("Contract Addresses")).toBeNull();
    expect(chainFromLabel("")).toBeNull();
    expect(chainFromLabel(null)).toBeNull();
  });

  it("matches on word boundaries, so 'Database' is not the Base chain", () => {
    expect(chainFromLabel("Database Migration Parameters")).toBeNull();
  });
});
