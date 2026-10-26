// A constant is "named in" a document only where exactly one document inside the
// Prime's artifact names it on the row's chain.
import { describe, expect, it } from "vitest";
import type { AtlasNode } from "../types.ts";
import { namedIn } from "./pauConstantDocs.ts";

const node = (id: string, title: string, content = "") => ({ id, title, content }) as AtlasNode;
const prime = node("prime", "Spark");
const eth = node("eth", "Ethereum Mainnet");
const arb = node("arb", "Arbitrum");
const a = node("a", "Check RateLimits", "Check `LIMIT_USDS_MINT` and `LIMIT_USDS_BURN`.");
const b = node("b", "Check RateLimits", "Check `LIMIT_USDS_BURN`.");
const c = node("c", "Check RateLimits", "Check `LIMIT_USDS_BURN`.");
const outside = node("outside", "Elsewhere", "Another prime names `LIMIT_ONLY_ELSEWHERE`.");
const docs = {
  docs: Object.fromEntries([prime, eth, arb, a, b, c, outside].map((n) => [n.id, n])),
  byParent: new Map([["prime", [eth, arb]], ["eth", [a, b]], ["arb", [c]], [null, [prime, outside]]]),
};

describe("namedIn", () => {
  const find = namedIn("prime", docs);
  it("names the one document inside the Prime's artifact that names the constant", () => {
    expect(find("LIMIT_USDS_MINT", "ethereum")?.id).toBe("a");
  });
  it("names none where several documents on the chain name it", () => {
    expect(find("LIMIT_USDS_BURN", "ethereum")).toBeNull();
  });
  it("counts only documents on the row's chain, so another chain's heading narrows it", () => {
    expect(find("LIMIT_USDS_BURN", "arbitrum")?.id).toBe("c");
    expect(find("LIMIT_USDS_MINT", "arbitrum")).toBeNull();
  });
  it("ignores documents outside the Prime's artifact, and answers none without documents", () => {
    expect(find("LIMIT_ONLY_ELSEWHERE", "ethereum")).toBeNull();
    expect(namedIn("prime", null)("LIMIT_USDS_MINT", "ethereum")).toBeNull();
    expect(namedIn(null, docs)("LIMIT_USDS_MINT", "ethereum")).toBeNull();
  });

  it("scopes a document by a chain named anywhere in an ancestor's title, as one whole word", () => {
    const mono = node("mono", "Monolithic Mainnet Controller Contract Functions");
    const step = node("step", "Decrease Withdraw Rate Limit", "Decrease `LIMIT_4626_WITHDRAW`.");
    const tree = {
      docs: Object.fromEntries([prime, mono, step].map((n) => [n.id, n])),
      byParent: new Map([["prime", [mono]], ["mono", [step]], [null, [prime]]]),
    };
    const find = namedIn("prime", tree);
    expect(find("LIMIT_4626_WITHDRAW", "ethereum")?.id).toBe("step");
    for (const chain of ["robinhood", "base", "arbitrum", "optimism"]) expect(find("LIMIT_4626_WITHDRAW", chain)).toBeNull();
  });
  it("scopes a document by a chain-named ancestor above its parent, as Grove's mainnet section sits above its steps", () => {
    const mono = node("mono", "Monolithic Mainnet Controller Contract Functions");
    const group = node("group", "Redeem From ERC-4626 Vault");
    const step = node("step", "Decrease Withdraw Rate Limit", "Decrease `LIMIT_4626_WITHDRAW`.");
    const tree = {
      docs: Object.fromEntries([prime, mono, group, step].map((n) => [n.id, n])),
      byParent: new Map([["prime", [mono]], ["mono", [group]], ["group", [step]], [null, [prime]]]),
    };
    const find = namedIn("prime", tree);
    expect(find("LIMIT_4626_WITHDRAW", "ethereum")?.id).toBe("step");
    expect(find("LIMIT_4626_WITHDRAW", "robinhood")).toBeNull();
  });
});
