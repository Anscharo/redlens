// rehypeHashCodes: which code spans get `data-hash`, the signal the reader's
// code renderer uses to look a hash up as a rate-limit key.
import { describe, expect, it } from "vitest";
import type { Element, Root } from "hast";
import { rehypeHashCodes } from "./rehypeHashCodes";

const HASH = "0x" + "Ab".repeat(32);
const code = (value: string): Element => ({ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value }] });
const p = (...children: Element[]): Root => ({ type: "root", children: [{ type: "element", tagName: "p", properties: {}, children }] });
const transform = rehypeHashCodes()();

describe("rehypeHashCodes", () => {
  it("stamps a code span holding only a 64-hex value with the lowercased hash", () => {
    const c = code(` ${HASH} `);
    transform(p(c));
    expect(c.properties["data-hash"]).toBe(HASH.toLowerCase());
  });
  it("leaves an address, a longer hex string and mixed text alone", () => {
    const spans = [code("0x" + "a".repeat(40)), code(HASH + "0"), code(`id ${HASH}`)];
    transform(p(...spans));
    for (const s of spans) expect(s.properties["data-hash"]).toBeUndefined();
  });
  it("skips a code span already inside a link, as a transaction hash is", () => {
    const c = code(HASH);
    transform(p({ type: "element", tagName: "a", properties: { href: "https://etherscan.io/tx/x" }, children: [c] }));
    expect(c.properties["data-hash"]).toBeUndefined();
  });
});
