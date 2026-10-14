// A key's naming document is scoped to the chain heading above it: refs under
// no chain heading apply everywhere, and a ref under one applies to that chain.
import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types.ts";
import { refsOnChain, withRefChains } from "./pauKeyChains.ts";

const node = (id: string, title: string) => ({ id, title }) as AtlasNode;
const arb = node("arb", "Arbitrum");
const ids = node("ids", "Diamond PAU Rate Limit IDs");
const key = node("key", "Aggregate CCTP Rate Limit ID");
const flat = node("flat", "Some Instance");
const docs = { docs: Object.fromEntries([arb, ids, key, flat].map((n) => [n.id, n])), byParent: new Map([[null, [ids, flat]], ["ids", [arb]], ["arb", [key]]]) };

describe("withRefChains", () => {
  it("sets the chain of a ref whose document sits under a chain heading, and leaves others alone", () => {
    const out = withRefChains(new Map([["0xk", [{ docId: "key", label: "Aggregate CCTP" }]], ["0xf", [{ docId: "flat", label: "Flat" }]]]), docs);
    expect(out.get("0xk")).toEqual([{ docId: "key", label: "Aggregate CCTP", chain: "arbitrum" }]);
    expect(out.get("0xf")).toEqual([{ docId: "flat", label: "Flat" }]);
  });
  it("keeps the refs that apply on a chain", () => {
    const refs = [{ docId: "a", label: "A", chain: "arbitrum" }, { docId: "b", label: "B" }];
    expect(refsOnChain(refs, "ethereum").map((r) => r.docId)).toEqual(["b"]);
    expect(refsOnChain(refs, "arbitrum").map((r) => r.docId)).toEqual(["a", "b"]);
  });
  it("is the index itself before the documents load", () => {
    const index = new Map([["0xk", [{ docId: "key", label: "x" }]]]);
    expect(withRefChains(index, null)).toBe(index);
  });
});
