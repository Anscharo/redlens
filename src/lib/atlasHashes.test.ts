// The atlas hash classifier: a 64-hex value is typed by the words before it on
// its line, else by its document's title, and named by the instance it sits in.
import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types";
import { atlasHashIndex, hashKind, unclassifiedHashes } from "./atlasHashes.ts";

const h = (c: string) => "0x" + c.repeat(64);
const doc = (id: string, doc_no: string, title: string, content = "") => ({ id, doc_no, title, content }) as AtlasNode;

describe("hashKind", () => {
  it("reads the label on the hash's line before the document title", () => {
    expect(hashKind("August 2025 Grant", "- Transaction Hash: `")).toBe("transaction");
    expect(hashKind("ETH/USDC 86% LLTV Pool", "- Pool ID: ")).toBe("pool-id");
    expect(hashKind("Rate Limit IDs", "- `deposit`: `")).toBe("rate-limit-id");
    expect(hashKind("Pool ID", "")).toBe("pool-id");
    expect(hashKind("Notes", "The value is `")).toBeNull();
  });
});

describe("atlasHashIndex", () => {
  const docs = [
    doc("g", "A.2.13.1.1.1", "August 2025 Grant", `- Recipient: X\n- Transaction Hash: \`${h("1")}\``),
    doc("g2", "A.2.13.1.2.1", "August 2025 Grant", `- Transaction Hash: \`${h("1").toUpperCase().replace("0X", "0x")}\``),
    doc("icd", "A.6.1.1.1.2.6.1.3.2.1.1", "Base - Morpho Blue USDC ERC4626 Vault Instance Configuration Document"),
    doc("pool", "A.6.1.1.1.2.6.1.3.2.1.1.4.1.1", "ETH/USDC 86% LLTV Pool", `- Pool ID: ${h("2")}\n- Supply cap: 1`),
    doc("icd2", "A.6.1.1.1.2.6.1.3.1.8.1", "Ethereum Mainnet - Uniswap v4 PYUSD/USDS Pool Instance Configuration Document"),
    doc("uni", "A.6.1.1.1.2.6.1.3.1.8.1.2.2.2", "Pool ID", `\`${h("3")}\``),
    doc("rl", "A.6.1.1.2.2.6.1.2.1.1.3.2.1", "USDS Mint RateLimitID", `The LIMIT_USDS_MINT RateLimitID is: \`${h("4")}\``),
    doc("odd", "A.1.1", "Notes", `A value \`${h("5")}\`.`),
  ];
  const ix = atlasHashIndex(docs);

  it("lists each document that states a hash, case-folded", () => {
    expect(ix.get(h("1"))?.map((r) => r.docId)).toEqual(["g", "g2"]);
    expect(ix.get(h("1"))?.[0]).toMatchObject({ kind: "transaction", kindLabel: "transaction hash", title: "August 2025 Grant", instance: null });
  });
  it("names a pool ID by the protocol of the instance it sits in", () => {
    expect(ix.get(h("2"))?.[0]).toMatchObject({ kindLabel: "Morpho market ID", instance: "Base - Morpho Blue USDC ERC4626 Vault" });
    expect(ix.get(h("3"))?.[0]).toMatchObject({ kindLabel: "Uniswap v4 pool ID", instance: "Ethereum Mainnet - Uniswap v4 PYUSD/USDS Pool" });
  });
  it("types a RateLimitID, and leaves an untyped hash out so it reads as a gap", () => {
    expect(ix.get(h("4"))?.[0]).toMatchObject({ kind: "rate-limit-id", kindLabel: "rate limit ID", instance: null });
    expect(ix.has(h("5"))).toBe(false);
    expect(unclassifiedHashes(docs, ix)).toEqual([h("5")]);
  });
});
