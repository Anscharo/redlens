// Coverage for the address-anchored chain-candidate detector — the half of
// census:chains that can spot a chain nobody named in advance.
//
// The regression these lock in is concrete: before this detector existed, the
// census's prose scan (`<Proper Noun> Chain|Network|Mainnet|…`) could only see
// two-word chain references, so the single-word "Unichain" bullet rows in
// A.2.11.1.2.2.3.3.2 "Asset Recovery Addresses" were invisible. Three addresses
// were attributed to unichain while the census reported it unseen.

import { describe, it, expect } from "vitest";
import { chainNamedIn, rowLabel, findChainKeyedOddRows } from "../scripts/lib/chain-candidates.mjs";

// The real shape from the atlas doc that surfaced the Unichain bug, with the
// offending chain swapped for one the registry still doesn't know.
const ASSET_RECOVERY = `The value of the \`assetRecoveryAddress\` parameter for each chain is:

- Ethereum Mainnet - \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\`
- Arbitrum - \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\`
- Optimism - \`0x20E6593CDda8c58a1d0f14C5164B376352a55f2F\`
- Base - \`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\`
- Berachain - \`0x3510a7F16F549EcD0Ef018DE0B3c2ad7c742990f\`
- Solana - \`AYPtjx4Hc8us1ikULUedkmZ3wtiD6tmL7gK3qe4V3oHt\`
- Avalanche - \`0xe928885BCe799Ed933651715608155F01abA23cA\`
- Plasma - \`0x5CE28f2dD353945db9AB3273A2a1dD1AB632e24b\``;

describe("chainNamedIn", () => {
  it("matches on word boundaries, so a substring is not a chain", () => {
    expect(chainNamedIn("Base")).toBe("base");
    expect(chainNamedIn("Database Registry")).toBeNull();
    expect(chainNamedIn("Baserate Parameters")).toBeNull();
  });

  it("knows solana, which has no CHAIN_HINTS entry", () => {
    // detectChain never runs on Solana (base58 shape attributes it instead), so
    // it is deliberately absent from CHAIN_HINTS — but a "- Solana - <addr>"
    // row still names a chain we know and must never be reported as odd.
    expect(chainNamedIn("Solana")).toBe("solana");
  });

  it("counts the promoted chains as naming themselves", () => {
    expect(chainNamedIn("Plasma")).toBe("plasma");
    expect(chainNamedIn("Monad")).toBe("monad");
    expect(chainNamedIn("Plume")).toBe("plume");
  });

  it("inherits the gnosis exclusion rather than re-deriving it", () => {
    expect(chainNamedIn("Gnosis Safe")).toBeNull();
    expect(chainNamedIn("Gnosis")).toBe("gnosis");
  });

  it("returns null for an empty label", () => {
    expect(chainNamedIn("")).toBeNull();
    expect(chainNamedIn(undefined)).toBeNull();
  });
});

describe("rowLabel", () => {
  it("strips bullet markers and the label/value separator", () => {
    expect(rowLabel("- Unichain - ")).toBe("Unichain");
    expect(rowLabel("* Base: ")).toBe("Base");
    expect(rowLabel("1. Arbitrum — ")).toBe("Arbitrum");
  });

  it("strips table pipes from both ends", () => {
    expect(rowLabel("| Base | ")).toBe("Base");
    expect(rowLabel("| ALM Proxy | Optimism | ")).toBe("ALM Proxy | Optimism");
  });

  it("is empty for a bare address line", () => {
    expect(rowLabel("")).toBe("");
    expect(rowLabel("  ")).toBe("");
  });
});

describe("findChainKeyedOddRows", () => {
  it("finds the unregistered chain in a per-chain address list", () => {
    const odd = findChainKeyedOddRows(ASSET_RECOVERY);
    expect(odd.map((o) => o.label)).toEqual(["Berachain"]);
    // The sibling chains are the evidence that the list is keyed by chain.
    expect(odd[0].siblings).toContain("arbitrum");
    expect(odd[0].siblings).toContain("solana");
  });

  it("self-heals once the chain is registered", () => {
    // Unichain is registered, so its row in the real doc is no longer odd.
    expect(findChainKeyedOddRows(ASSET_RECOVERY.replace(/Berachain/g, "Unichain"))).toEqual([]);
  });

  it("ignores an entity list that is not keyed by chain", () => {
    const entities = `- Pause Proxy - \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\`
- Spark Proxy - \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\`
- Grove Proxy - \`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\``;
    expect(findChainKeyedOddRows(entities)).toEqual([]);
  });

  it("requires two DISTINCT chains, so one repeated chain name is not a chain-keyed list", () => {
    // A list of Ethereum contracts mentioning "Ethereum" twice is an entity
    // list, not a per-chain list — the third row is a contract, not a chain.
    const sameChain = `- Ethereum Pause Proxy - \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\`
- Ethereum Spark Proxy - \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\`
- Allocator Vault - \`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\``;
    expect(findChainKeyedOddRows(sameChain)).toEqual([]);
  });

  it("finds odd rows in a markdown table", () => {
    const table = `| Chain | Address |
| --- | --- |
| Ethereum | \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\` |
| Base | \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\` |
| Berachain | \`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\` |`;
    expect(findChainKeyedOddRows(table).map((o) => o.label)).toEqual(["Berachain"]);
  });

  it("does not join two unrelated lists separated by prose", () => {
    const split = `- Ethereum - \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\`
- Base - \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\`

Some intervening prose that closes the block.

- Pause Proxy - \`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\``;
    // The Pause Proxy row belongs to its own block, which names no chains.
    expect(findChainKeyedOddRows(split)).toEqual([]);
  });

  it("tolerates blank lines inside a loosely-spaced list", () => {
    const spaced = `- Ethereum - \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\`

- Base - \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\`

- Berachain - \`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\``;
    expect(findChainKeyedOddRows(spaced).map((o) => o.label)).toEqual(["Berachain"]);
  });

  it("ignores a bare address line, which carries no claim to judge", () => {
    const bare = `- Ethereum - \`0xbe8e3e3618f7474f8cb1d074a26affef007e98fb\`
- Base - \`0x10E6593CDda8c58a1d0f14C5164B376352a55f2F\`
\`0xdD0BCc201C9E47c6F6eE68E4dB05b652Bb6aC255\``;
    expect(findChainKeyedOddRows(bare)).toEqual([]);
  });

  it("handles empty content", () => {
    expect(findChainKeyedOddRows("")).toEqual([]);
    expect(findChainKeyedOddRows(undefined)).toEqual([]);
  });
});
