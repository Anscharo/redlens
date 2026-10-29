// Naming material of verified sources: hashed LIMIT_* names (whatever local
// name binds them), address and bytes32 constants of every visibility, and the
// address constants named as a spell; a mutable address, a hash that is not a
// constant and an unreadable cache file give none.
import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cachedSourceMaterial, materialOf, mergeMaterial } from "./source-material.ts";

const [USDC, FARM, OWNER, SPELL] = ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "0x173e314C7635B45322cd8Cb14f44b312e079F3af", "0x" + "1".repeat(40), "0x4a3a40957CDc47552E2BE2012d127A5f4BD7f689"];
const POOL = "0x" + "e6".repeat(32);
const lines = [
  `address internal constant USDC  = ${USDC};`,
  `address public constant USDS_SPK_FARM = ${FARM};`,
  `address constant AGAIN = ${USDC.toLowerCase()};`,
  `address public owner = ${OWNER};`,
  `address internal constant SPARK_SPELL = ${SPELL};`,
  `bytes32 internal constant PYUSD_USDS_POOL_ID = ${POOL};`,
  `bytes32 public constant LIMIT_DEPOSIT = keccak256("LIMIT_UNISWAP_V4_DEPOSIT");`,
  `emit Set(0x${"ab".repeat(32)});`,
];

describe("materialOf", () => {
  it("reads names, address and bytes32 constants, and spells, lowercased and once each", () => {
    expect(materialOf(lines.join("\n"))).toEqual({
      names: ["LIMIT_UNISWAP_V4_DEPOSIT"],
      addresses: [SPELL, FARM, USDC].map((a) => a.toLowerCase()).sort(),
      words: [POOL],
      spells: [SPELL.toLowerCase()],
    });
  });
  it("reads a multi-file source, whose lines and quotes are escaped inside a JSON string", () => {
    const escaped = JSON.stringify({ sources: { "a.sol": { content: lines.join("\n") } } });
    const m = materialOf(`{${escaped}}`);
    expect([m.names, m.words, m.spells.length, m.addresses.length]).toEqual([["LIMIT_UNISWAP_V4_DEPOSIT"], [POOL], 1, 3]);
  });
});

describe("cachedSourceMaterial", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sources-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "1"));
  fs.writeFileSync(path.join(dir, "1", "0xspell.json"), JSON.stringify({ contractName: "Spell", sourceCode: lines.join("\n") }));
  fs.writeFileSync(path.join(dir, "1", "0xbroken.json"), "{ truncated");

  it("merges every cached source, skipping an unreadable one", () => {
    expect(cachedSourceMaterial(dir)).toEqual(mergeMaterial([materialOf(lines.join("\n"))]));
  });
  it("is empty without a cache", () => {
    expect(cachedSourceMaterial(path.join(dir, "missing"))).toEqual({ names: [], addresses: [], words: [], spells: [] });
  });
});
