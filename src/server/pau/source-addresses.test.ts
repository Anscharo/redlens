// Address constants of the cached verified sources: every visibility of
// `address constant`, lowercased and deduplicated; a mutable address, a hash
// and an unreadable cache file are not read.
import { afterAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sourceAddressConstants } from "./source-addresses.ts";

const [USDC, FARM, OWNER] = ["0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", "0x173e314C7635B45322cd8Cb14f44b312e079F3af", "0x" + "1".repeat(40)];

describe("sourceAddressConstants", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sources-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "1"));
  const source = [
    `address internal constant USDC  = ${USDC};`,
    `address public constant USDS_SPK_FARM = ${FARM};`,
    `address constant AGAIN = ${USDC.toLowerCase()};`,
    `address public owner = ${OWNER};`,
    `bytes32 internal constant ID = 0x${"ab".repeat(32)};`,
  ].join("\\n");
  fs.writeFileSync(path.join(dir, "1", "0xspell.json"), JSON.stringify({ contractName: "Spell", sourceCode: `{{"sources": {"a.sol": {"content": "${source}"}}}}` }));
  fs.writeFileSync(path.join(dir, "1", "0xbroken.json"), "{ truncated");

  it("reads every address constant once, lowercased", () => {
    expect(sourceAddressConstants(dir)).toEqual([USDC.toLowerCase(), FARM.toLowerCase()].sort());
  });
  it("is empty without a cache", () => {
    expect(sourceAddressConstants(path.join(dir, "missing"))).toEqual([]);
  });
});
