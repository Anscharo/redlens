import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import for parser access
import { extractEthAddresses, extractUrl, parseMarkdownTable } from "../scripts/lib/table-parser.mjs";

describe("extractEthAddresses", () => {
  it("extracts a plain 0x40-hex address", () => {
    const cell = "0xAbC" + "0".repeat(33) + "dEaD"; // 40 hex chars total
    expect(extractEthAddresses(cell)).toEqual(["0xabc" + "0".repeat(33) + "dead"]);
  });

  it("does not yield a bogus address from a 64-hex tx hash", () => {
    const txHash = "0x" + "11".repeat(32); // 64 hex chars — a tx hash, not an address
    expect(extractEthAddresses(txHash)).toEqual([]);
  });

  it("does not match a 40-hex substring embedded in a longer hex run", () => {
    // 72 hex chars total — well past a 40-char address, on both sides.
    const longHex = "0x" + "ab".repeat(36);
    expect(extractEthAddresses(longHex)).toEqual([]);
  });

  it("still matches a real address adjacent to non-hex punctuation", () => {
    const addr = "0x" + "0".repeat(39) + "1"; // 40 hex chars total
    const cell = `see ${addr} for details`;
    expect(extractEthAddresses(cell)).toEqual([addr]);
  });
});

describe("extractUrl", () => {
  it("extracts the url from a markdown link", () => {
    expect(extractUrl("[text](https://example.com/path)")).toBe("https://example.com/path");
  });

  it("returns null when there is no link", () => {
    expect(extractUrl("no link here")).toBeNull();
  });
});

describe("parseMarkdownTable", () => {
  it("parses a simple table into row objects", () => {
    const content = [
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "| 3 | 4 |",
    ].join("\n");
    expect(parseMarkdownTable(content)).toEqual([
      { A: "1", B: "2" },
      { A: "3", B: "4" },
    ]);
  });
});
