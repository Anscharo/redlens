// decodeLzReceive against a mainnet LzReceive of the Sky LayerZero governance
// program (svm-receipts.fixture.json, Solana tx 2YPDSHY9…, slot 419,054,807).
// Pinned: its guid is the one the Ethereum sender's GovernanceCallSent names
// for nonce 3 (tx 0xb03f728b…, block 25,072,324); the sending OApp, the calling
// SubProxy and the target are read from the message; anything else throws.
import { describe, expect, it } from "bun:test";
import fixture from "./svm-receipts.fixture.json" with { type: "json" };
import { decodeLzReceive, LZ_RECEIVE } from "./svm-receipts.ts";

const DATA = Object.values(fixture)[0].lzReceive;

describe("decodeLzReceive", () => {
  it("reads the guid, nonce, source and the message's caller and target", () => {
    expect(decodeLzReceive(DATA)).toEqual({
      guid: "0x410dd975b765e87168ac2a1837452aff2a39e08afb4f95f4909d6c0e8325be5f",
      nonce: "3",
      srcEid: 30101,
      sender: "0x27fc1dd771817b53be48dc28789533bea53c9cca",
      origin: "0x2bebfe397d497b66cb14461cb6ee467b4c3b7d61",
      target: "SKYTAiJRkgexqQqFoqhXdCANyfziwrVrzjhBaCzdbKW",
    });
  });
  it("throws on another instruction, a short message or a sender that is not an EVM address", () => {
    expect(() => decodeLzReceive(`00${DATA.slice(2)}`)).toThrow(/not an LzReceive/);
    expect(() => decodeLzReceive(DATA.slice(0, 300))).toThrow(/message holds/);
    expect(() => decodeLzReceive(`${LZ_RECEIVE}95750000ff${DATA.slice(26)}`)).toThrow(/not an EVM address/);
  });
});
