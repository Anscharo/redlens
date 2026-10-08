// The chain an instance is on, read whole from its Network param or its name's
// "<Chain> - " prefix, never from a chain word elsewhere in the name.
import { describe, expect, it } from "vitest";
import { chainOfLabel, instanceChain } from "./pauInstanceChain.ts";
import type { ValueSource } from "./pauInstanceKeys.ts";

const src = (name: string, network?: string): ValueSource => ({ name, params: network ? { Network: [network, null] } : {} });

describe("instance chain", () => {
  it("reads registry names and hints whole", () => {
    expect(["Ethereum Mainnet", "Arbitrum One", "X Layer", "Avalanche C-Chain", "Robinhood Chain", "Base", "OP Mainnet"].map(chainOfLabel)).toEqual(["ethereum", "arbitrum", "xlayer", "avalanche", "robinhood", "base", "optimism"]);
    expect(chainOfLabel("Coinbase")).toBeNull();
  });
  it("takes the Network param or the name prefix, and gives up when they disagree or name nothing", () => {
    expect(instanceChain(src("Ethereum Mainnet - Coinbase Custody"))).toBe("ethereum");
    expect(instanceChain(src("Vault", "Base"))).toBe("base");
    expect(instanceChain(src("Ethereum Mainnet - Vault", "Base"))).toBeNull();
    expect(instanceChain(src("Spark's Instance of the Agent Creation Primitive"))).toBeNull();
  });
});
