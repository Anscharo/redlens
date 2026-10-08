// RateLimitIDs in the param walk (scripts/lib/graph-instances.mjs) and the
// prime-level pass (scripts/lib/graph-prime-rate-limits.ts): every title that
// names a RateLimitID yields the bare hash, whatever sentence or bullet carries
// it, and a prime's controller-wide keys are read without its instances'.
import { describe, it, expect } from "vitest";
import { buildChildrenIndex, extractInstanceParams } from "../scripts/lib/graph-instances.mjs";
import { attachPrimeRateLimitParams, primeRateLimitParams } from "../scripts/lib/graph-prime-rate-limits.ts";

const doc = (id: string, doc_no: string, title: string, content = "") => ({
  id, doc_no, title, content, type: "Core", depth: 6, parentId: null, order: 0, addressRefs: [],
});
const h = (c: string) => "0x" + c.repeat(64);

describe("RateLimitID params inside an instance", () => {
  const ICD = "A.6.1.1.9.2.1.2.1";
  const docs = [
    doc("icd", ICD, "Ethereum Mainnet - Test Instance Configuration Document"),
    doc("p", `${ICD}.1`, "Parameters"),
    doc("agg", `${ICD}.1.1`, "Aggregate Deposit RateLimitID", `The aggregate deposit RateLimitID is: \`${h("a")}\`.`),
    doc("ids", `${ICD}.1.2`, "Rate Limit IDs", `- \`deposit\`: \`${h("b")}\`\n- \`withdraw\`: \`${h("c")}\``),
    doc("one", `${ICD}.1.3`, "Conduit", ""),
    doc("tx", `${ICD}.1.3.1`, "Rate Limit IDs", `The transferAssets \`RateLimitID\` for this conduit is: \`${h("d")}\`.`),
    doc("na", `${ICD}.1.4`, "Outflow RateLimitID", "The outflow RateLimitID is: N/A for this Instance."),
    doc("lim", `${ICD}.1.5`, "Inflow Rate Limits", "The inflow rate limits are:\n\n- `maxAmount`: 1,000 USDS"),
  ];
  const params = extractInstanceParams(docs[0], buildChildrenIndex(docs)) as Record<string, [string, string, string]>;

  it("takes the hash out of a sentence under any RateLimitID title", () => {
    expect(params["Aggregate Deposit RateLimitID"][0]).toBe(h("a"));
    expect(params["Rate Limit IDs"][0]).toBe(h("d"));
  });
  it("unwraps each bullet's backticked hash under a RateLimitID title, and leaves other bullets as written", () => {
    expect(params["Rate Limit IDs / deposit"][0]).toBe(h("b"));
    expect(params["Rate Limit IDs / withdraw"][0]).toBe(h("c"));
    expect(params["Inflow Rate Limits / maxAmount"][0]).toBe("1,000 USDS");
  });
  it("keeps an N/A key as N/A", () => {
    expect(params["Outflow RateLimitID"][0]).toBe("N/A for this Instance");
  });
});

describe("primeRateLimitParams", () => {
  const P = "A.6.1.1.2";
  const docs = [
    doc("prime", P, "Grove"),
    doc("rl", `${P}.1`, "RateLimits"),
    doc("ids", `${P}.1.1`, "Diamond PAU Rate Limit IDs"),
    doc("arb", `${P}.1.1.1`, "Arbitrum"),
    doc("cctp", `${P}.1.1.1.1`, "Aggregate CCTP Rate Limit ID", `The Aggregate CCTP RateLimitID is: \`${h("1")}\`.`),
    doc("mint", `${P}.1.1.2`, "USDS Mint RateLimitID", `The LIMIT_USDS_MINT RateLimitID is: \`${h("2")}\`.`),
    doc("prims", `${P}.2`, "Sky Primitives"),
    doc("icd", `${P}.2.1`, "Ethereum Mainnet - Vault Instance Configuration Document"),
    doc("ip", `${P}.2.1.1`, "Parameters"),
    doc("iids", `${P}.2.1.1.1`, "Rate Limit IDs", `The transferAssets RateLimitID is: \`${h("3")}\`.`),
  ];
  const children = buildChildrenIndex(docs);

  it("reads every Rate Limit IDs section under the prime, nested ones included, and skips instances", () => {
    expect(primeRateLimitParams(docs[0], children)).toEqual({
      "Aggregate CCTP Rate Limit ID": [h("1"), "cctp", `${P}.1.1.1.1`],
      "USDS Mint RateLimitID": [h("2"), "mint", `${P}.1.1.2`],
    });
  });

  it("puts them in the prime entity's meta.params beside its other meta, and leaves a prime without any alone", () => {
    const grove = { entity_type: "agent", subtype: "prime", defining_doc_id: "prime", meta: JSON.stringify({ forum_handle: "g" }) };
    const keel = { entity_type: "agent", subtype: "prime", defining_doc_id: "none", meta: null };
    const other = { entity_type: "agent", subtype: "core_executor", defining_doc_id: "prime", meta: null };
    attachPrimeRateLimitParams(new Map(Object.entries({ grove, keel, other })), new Map(docs.map((d) => [d.id, d])), children);
    expect(JSON.parse(grove.meta!)).toMatchObject({ forum_handle: "g", params: { "USDS Mint RateLimitID": [h("2"), "mint", expect.any(String)] } });
    expect(keel.meta).toBeNull();
    expect(other.meta).toBeNull();
  });
});
