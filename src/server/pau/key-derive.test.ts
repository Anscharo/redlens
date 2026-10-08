// Rate-limit key derivation: each encoding shape the controllers use reproduces
// its key (the bare constant against the known LIMIT_USDS_MINT id), an
// underivable key is null, and the ABI and address loaders tolerate a
// truncated cache file and missing artifacts.
import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeAbiParameters, keccak256, toHex } from "viem";
import { candidateAddresses, keyDeriver, limitConstants } from "./key-derive.ts";
import { withDerivedKeys } from "./snapshot.ts";
import type { PauSnapshot } from "../../lib/pau.ts";

const VAULT = "0x" + "a".repeat(40);
const DEST = "0x" + "b".repeat(40);
const base = (c: string) => keccak256(toHex(c));
const enc = (types: string[], values: unknown[]) => keccak256(encodeAbiParameters(types.map((type) => ({ type })), values));

describe("keyDeriver", () => {
  const derive = keyDeriver(["LIMIT_USDS_MINT", "LIMIT_4626_DEPOSIT", "LIMIT_USDC_TO_DOMAIN", "LIMIT_ASSET_TRANSFER", "LIMIT_LAYERZERO_TRANSFER"], [VAULT, DEST]);

  it("names the bare constant, matching the atlas-stated LIMIT_USDS_MINT id", () => {
    expect(base("LIMIT_USDS_MINT").startsWith("0xcb0537d5e5dba65a8edbac12555995860e5b8e1b70996011edb")).toBe(true);
    expect(derive(base("LIMIT_USDS_MINT").toUpperCase().replace("0X", "0x"))).toEqual({ constant: "LIMIT_USDS_MINT", args: [] });
  });
  it("names a key encoded with an address, a domain, an address pair, or an address and endpoint id", () => {
    expect(derive(enc(["bytes32", "address"], [base("LIMIT_4626_DEPOSIT"), VAULT]))).toEqual({ constant: "LIMIT_4626_DEPOSIT", args: [VAULT] });
    expect(derive(enc(["bytes32", "uint32"], [base("LIMIT_USDC_TO_DOMAIN"), 3]))).toEqual({ constant: "LIMIT_USDC_TO_DOMAIN", args: ["3"] });
    expect(derive(enc(["bytes32", "address", "address"], [base("LIMIT_ASSET_TRANSFER"), VAULT, DEST]))).toEqual({ constant: "LIMIT_ASSET_TRANSFER", args: [VAULT, DEST] });
    expect(derive(enc(["bytes32", "address", "uint32"], [base("LIMIT_LAYERZERO_TRANSFER"), VAULT, 30110]))).toEqual({ constant: "LIMIT_LAYERZERO_TRANSFER", args: [VAULT, "30110"] });
  });
  it("tries an address pair only for the transfer constants, and returns null for a key nothing derives", () => {
    expect(derive(enc(["bytes32", "address", "address"], [base("LIMIT_4626_DEPOSIT"), VAULT, DEST]))).toBeNull();
    expect(derive("0x" + "9".repeat(64))).toBeNull();
  });
});

describe("loaders", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pau-abi-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "1"));
  const abi = [
    { type: "function", name: "LIMIT_USDS_MINT", inputs: [] },
    { type: "function", name: "LIMIT_KEY", inputs: [{ type: "bytes32" }] },
    { type: "function", name: "proxy", inputs: [] },
  ];
  fs.writeFileSync(path.join(dir, "1", "a.json"), JSON.stringify({ abi: JSON.stringify(abi) }));
  fs.writeFileSync(path.join(dir, "1", "broken.json"), '{"abi": "[');

  it("reads zero-argument LIMIT_* views and skips an unreadable cache file", () => {
    expect(limitConstants(dir)).toEqual(["LIMIT_USDS_MINT"]);
    expect(limitConstants(path.join(dir, "missing"))).toEqual([]);
  });
  it("collects addresses from the artifacts that exist and from the extras", () => {
    const f = path.join(dir, "addresses.json");
    fs.writeFileSync(f, JSON.stringify({ [VAULT]: {}, notAnAddress: {} }));
    expect(candidateAddresses([f, path.join(dir, "gone.json")], { members: [{ address: DEST }] }).sort()).toEqual([VAULT, DEST].sort());
  });
});

describe("withDerivedKeys", () => {
  it("attaches a derivation to the keys that have one and leaves the rest as they were", () => {
    const limit = (key: string) => ({ key, configured: { maxAmount: "1", slope: "0" }, setAt: { block: 1, time: "", tx: "" }, changes: 1, data: null, available: null });
    const snap = { deployment: "d", prime: "p", primeName: "P", chain: "ethereum", kind: "monolithic", contracts: [
      { role: "rateLimits", address: DEST, events: 2, historyComplete: true, rateLimits: [limit("0x01"), limit("0x02")] },
      { role: "controller", address: VAULT, events: 0, historyComplete: true },
    ] } as PauSnapshot;
    const out = withDerivedKeys(snap, (k) => (k === "0x01" ? { constant: "LIMIT_X", args: [] } : null));
    expect(out.contracts[0].rateLimits?.map((r) => r.derived ?? null)).toEqual([{ constant: "LIMIT_X", args: [] }, null]);
    expect(out.contracts[1]).toBe(snap.contracts[1]);
  });
});
