import { describe, it, expect } from "vitest";
import type { AddressBalances } from "@/lib/balances";
import type { MultisigFact } from "@/lib/addressGraphFacts";
import { makeAddressInfo } from "../test/fixtures";
import { resolveSafes } from "./addressSafe";

const ADDR = "0x492aae70e59551768baf3c7159d3f951b6ed76fe";
const O1 = "0xaaaa000000000000000000000000000000000001";
const O2 = "0xbbbb000000000000000000000000000000000002";
const O3 = "0xcccc000000000000000000000000000000000003";

const read = (chain: string, safe: AddressBalances["safe"]): AddressBalances => ({ chain, checkedAt: null, balances: {}, hasCode: null, safe });
const atlas = (chain: string, required: number, total: number): MultisigFact => ({ name: "Spark Operator Multisig", chain, threshold: { required, total }, docId: "root" });

function setup(chains: string[], reads: Record<string, AddressBalances>) {
  return { map: { [ADDR]: makeAddressInfo({ chain: chains[0], chains }) }, reads };
}

describe("resolveSafes", () => {
  it("shows the chain's setup and no atlas line when the atlas agrees", () => {
    const { map, reads } = setup(["ethereum"], { [`${ADDR}|ethereum`]: read("ethereum", { threshold: 2, owners: [O1, O2, O3] }) });
    expect(resolveSafes(ADDR, map, reads, [atlas("ethereum", 2, 3)])).toEqual([
      { threshold: 2, owners: [O1, O2, O3], chains: ["ethereum"], atlas: null },
    ]);
  });

  it("adds the atlas's threshold when it disagrees with the chain", () => {
    const { map, reads } = setup(["ethereum"], { [`${ADDR}|ethereum`]: read("ethereum", { threshold: 2, owners: [O1, O2] }) });
    const [safe] = resolveSafes(ADDR, map, reads, [atlas("ethereum", 2, 3)]);
    expect(safe.atlas).toEqual({ name: "Spark Operator Multisig", required: 2, total: 3, docId: "root" });
  });

  it("merges chains with the same setup and keeps a differing chain apart", () => {
    const same = { threshold: 2, owners: [O1, O2, O3] };
    const { map, reads } = setup(["arbitrum", "base", "optimism"], {
      [`${ADDR}|arbitrum`]: read("arbitrum", same),
      [`${ADDR}|base`]: read("base", same),
      [`${ADDR}|optimism`]: read("optimism", { threshold: 1, owners: [O1] }),
    });
    expect(resolveSafes(ADDR, map, reads, []).map((s) => s.chains)).toEqual([["arbitrum", "base"], ["optimism"]]);
  });

  it("shows nothing without an on-chain read, whatever the atlas states", () => {
    const { map } = setup(["ethereum"], {});
    expect(resolveSafes(ADDR, map, {}, [atlas("ethereum", 2, 3)])).toEqual([]);
  });
});
