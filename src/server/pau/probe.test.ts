// The live read behind "not set": a key is unset only when every field of its
// RateLimitData is zero, a failed read says nothing, and a key the contract
// holds that the history lacks is reported as missed.
import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atlasKeysByPrime, probeKeys } from "./probe.ts";
import type { ChainCall } from "./snapshot.ts";

const k = (c: string) => "0x" + c.repeat(64);
const zero = { maxAmount: 0n, slope: 0n, lastAmount: 0n, lastUpdated: 0n };

describe("probeKeys", () => {
  it("reads only keys the history lacks, and tells unset from set from unread", async () => {
    const seen: ChainCall[] = [];
    const read = async (_c: string, calls: ChainCall[]) => {
      seen.push(...calls);
      return calls.map((c) => (c.args[0] === k("1") ? zero : c.args[0] === k("2") ? { ...zero, lastUpdated: 5n } : null));
    };
    expect(await probeKeys(read, "ethereum", "0xrl", [k("1"), k("2"), k("3"), k("4"), k("1").toUpperCase().replace("0X", "0x")], new Set([k("4")]))).toEqual({ unset: [k("1")], missed: true });
    expect(seen.map((c) => c.args[0])).toEqual([k("1"), k("2"), k("3")]);
    expect(await probeKeys(read, "ethereum", "0xrl", [k("4")], new Set([k("4")]))).toEqual({ unset: [], missed: false });
  });
});

describe("atlasKeysByPrime", () => {
  it("collects each prime's and its instances' RateLimitID hashes", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "probe-")), "graph.json");
    const meta = (o: object) => JSON.stringify(o);
    fs.writeFileSync(file, JSON.stringify({ entities: [
      { id: "p", entity_type: "agent", meta: meta({ params: { "USDS Mint RateLimitID": [k("a"), "d"] } }) },
      { id: "i", entity_type: "instance", meta: meta({ agent_doc_id: "p", params: { "Inflow RateLimitID": [k("b"), "d"], "Token Address": ["0x" + "1".repeat(40), "d"], "Rate Limit IDs": ["to be specified", "d"] } }) },
    ] }));
    expect(atlasKeysByPrime(file)).toEqual(new Map([["p", [k("a"), k("b")]]]));
    expect(atlasKeysByPrime(path.join(path.dirname(file), "missing.json"))).toEqual(new Map());
  });
});
