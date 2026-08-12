// Unit tests for ICD / primitive instance parameter extraction
// (scripts/lib/graph-instances.mjs). Doc_nos follow the A.6.1.1.X.2.G.P
// primitive-root shape from the parse-atlas skill (Pattern 2 / Pattern 14).

import { describe, it, expect } from "vitest";
import {
  buildKnownPrimitives,
  primitiveSlugFromTitle,
  primitiveDisplayName,
  deriveInstanceName,
  primitiveStatusFor,
  classifyIcd,
  buildChildrenIndex,
  extractInstanceParams,
  // @ts-expect-error — .mjs without types; runtime-only import.
} from "../scripts/lib/graph-instances.mjs";

function mkDoc(id: string, doc_no: string, title: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    doc_no,
    title,
    type: (opts.type as string) ?? "Core",
    depth: Math.min(doc_no.split(".").length - 1, 6),
    parentId: (opts.parentId as string | null) ?? null,
    order: (opts.order as number) ?? 0,
    content: (opts.content as string) ?? "",
    addressRefs: (opts.addressRefs as string[]) ?? [],
  };
}

const CURRENT_PRIMITIVES_UUID = "203b8c79-c7cf-4fcc-94e3-5bf42f791619";

describe("buildKnownPrimitives", () => {
  it("collects indented list items, excludes top-level category headings", () => {
    const doc = mkDoc(CURRENT_PRIMITIVES_UUID, "A.2.2.1", "Current Primitives", {
      content:
        "Genesis Primitives\n  - Agent Creation Primitive\n  - Prime Transformation Primitive\nOperational Primitives\n  - Distribution Reward Primitive\n",
    });
    const docById = new Map([[doc.id, doc]]);
    const known = buildKnownPrimitives(docById);
    expect(known.has("Agent Creation Primitive")).toBe(true);
    expect(known.has("Prime Transformation Primitive")).toBe(true);
    expect(known.has("Distribution Reward Primitive")).toBe(true);
    expect(known.has("Genesis Primitives")).toBe(false);
    expect(known.has("Operational Primitives")).toBe(false);
    expect(known.size).toBe(3);
  });

  it("returns an empty set when the Current Primitives doc is absent", () => {
    expect(buildKnownPrimitives(new Map()).size).toBe(0);
  });

  it("returns an empty set when the doc exists but has no content", () => {
    const doc = mkDoc(CURRENT_PRIMITIVES_UUID, "A.2.2.1", "Current Primitives", { content: "" });
    const docById = new Map([[doc.id, doc]]);
    expect(buildKnownPrimitives(docById).size).toBe(0);
  });
});

describe("primitiveSlugFromTitle", () => {
  it("strips the Primitive suffix and slugifies", () => {
    expect(primitiveSlugFromTitle("Distribution Reward Primitive")).toBe("distribution-reward");
    expect(primitiveSlugFromTitle("Agent Token Primitive")).toBe("agent-token");
  });

  it("slugifies titles with no Primitive suffix unchanged otherwise", () => {
    expect(primitiveSlugFromTitle("Something Else")).toBe("something-else");
  });
});

describe("primitiveDisplayName", () => {
  it("strips the Primitive suffix and trims", () => {
    expect(primitiveDisplayName("Distribution Reward Primitive")).toBe("Distribution Reward");
  });

  it("leaves a title with no suffix as-is (trimmed)", () => {
    expect(primitiveDisplayName("No Suffix Title")).toBe("No Suffix Title");
  });
});

describe("deriveInstanceName", () => {
  const primRoot = mkDoc("prim1", "A.6.1.1.1.2.5.1", "Integration Boost Primitive");

  it("returns the raw ICD name verbatim when it isn't generic", () => {
    const icd = mkDoc("icd1", "A.6.1.1.1.2.5.1.2.1", "Aave Integration Boost Instance Configuration Document");
    expect(deriveInstanceName(icd, primRoot, null, {})).toBe("Aave Integration Boost");
  });

  it("derives the actor-scoped name from primRoot content for a generic 'Single' ICD", () => {
    const icd = mkDoc("icd2", "A.6.1.1.2.2.6.1.2.1", "Single Instance Configuration Document");
    const primRoot2 = mkDoc("prim2", "A.6.1.1.2.2.6.1", "Agent Token Primitive", {
      content: "Documents herein specify the configuration for Spark's Instance of the Agent Token Primitive. See [Agent Token Primitive](uuid-x).",
    });
    expect(deriveInstanceName(icd, primRoot2, null, {})).toBe("Spark's Instance of the Agent Token Primitive");
  });

  it("falls back to the bare 'Single' name with no agentDoc", () => {
    const icd = mkDoc("icd3", "A.6.1.1.1.2.5.1.2.2", "Single Instance Configuration Document");
    expect(deriveInstanceName(icd, primRoot, null, {})).toBe("Single");
  });

  it("builds an agent — primitive — partner name when the base name is generic and agentDoc is given", () => {
    const icd = mkDoc("icd4", "A.6.1.1.1.2.5.1.2.3", "Single Instance Configuration Document");
    const agentDoc = mkDoc("agent1", "A.6.1.1.1", "Spark");
    expect(
      deriveInstanceName(icd, primRoot, agentDoc, {
        "Integration Partner Name": ["Aave", "u", "d"],
      }),
    ).toBe("Spark — Integration Boost — Aave");
    // Without a partner param, the trailing segment is dropped.
    expect(deriveInstanceName(icd, primRoot, agentDoc, {})).toBe("Spark — Integration Boost");
  });

  it("treats an ICD name equal to the primitive root title as generic too", () => {
    const icd = mkDoc("icd5", "A.6.1.1.1.2.5.1.2.4", "Integration Boost Primitive Instance Configuration Document");
    const agentDoc = mkDoc("agent1", "A.6.1.1.1", "Spark");
    expect(deriveInstanceName(icd, primRoot, agentDoc, {})).toBe("Spark — Integration Boost");
  });
});

describe("primitiveStatusFor", () => {
  const primRoot = mkDoc("prim1", "A.6.1.1.1.2.1.1", "Distribution Reward Primitive");

  it("reads the backtick-wrapped Active token", () => {
    const statusDoc = mkDoc("status1", "A.6.1.1.1.2.1.1.1.1", "Global Activation Status", { content: "`Active`" });
    const docByDocNo = new Map([[statusDoc.doc_no, statusDoc]]);
    expect(primitiveStatusFor(primRoot, docByDocNo)).toBe("Active");
  });

  it("normalizes case for an un-backticked token", () => {
    const statusDoc = mkDoc("status2", "A.6.1.1.1.2.1.1.1.1", "Global Activation Status", { content: "completed" });
    const docByDocNo = new Map([[statusDoc.doc_no, statusDoc]]);
    expect(primitiveStatusFor(primRoot, docByDocNo)).toBe("Completed");
  });

  it("returns null when the status doc is missing", () => {
    expect(primitiveStatusFor(primRoot, new Map())).toBeNull();
  });

  it("returns null when the content doesn't match a known token", () => {
    const statusDoc = mkDoc("status3", "A.6.1.1.1.2.1.1.1.1", "Global Activation Status", { content: "Unclear." });
    const docByDocNo = new Map([[statusDoc.doc_no, statusDoc]]);
    expect(primitiveStatusFor(primRoot, docByDocNo)).toBeNull();
  });
});

describe("classifyIcd", () => {
  const primRoot = mkDoc("prim1", "A.6.1.1.1.2.1.1", "Distribution Reward Primitive");

  function tierMap(tierDocNo: string, tierTitle: string) {
    const tier = mkDoc("tier", tierDocNo, tierTitle);
    return new Map([[tier.doc_no, tier]]);
  }

  it("classifies an ICD under Active Instances", () => {
    const icd = mkDoc("icd1", "A.6.1.1.1.2.1.1.2.1", "Test Instance Configuration Document");
    const docByDocNo = tierMap("A.6.1.1.1.2.1.1.2", "Active Instances");
    expect(classifyIcd(icd, primRoot, docByDocNo)).toEqual({ kind: "instance", status: "Active" });
  });

  it("classifies an ICD under Completed Instances", () => {
    const icd = mkDoc("icd2", "A.6.1.1.1.2.1.1.3.1", "Test Instance Configuration Document");
    const docByDocNo = tierMap("A.6.1.1.1.2.1.1.3", "Completed Instances");
    expect(classifyIcd(icd, primRoot, docByDocNo)).toEqual({ kind: "instance", status: "Completed" });
  });

  it("classifies an ICD under Suspended Instances", () => {
    const icd = mkDoc("icd3", "A.6.1.1.1.2.1.1.5.1.2", "Test Instance Configuration Document");
    const docByDocNo = tierMap("A.6.1.1.1.2.1.1.5.1", "Suspended Instances");
    expect(classifyIcd(icd, primRoot, docByDocNo)).toEqual({ kind: "instance", status: "Suspended" });
  });

  it("classifies an ICD under In Progress Invocations", () => {
    const icd = mkDoc("icd4", "A.6.1.1.1.2.1.1.4.1", "Test Invocation Instance Configuration Document");
    const docByDocNo = tierMap("A.6.1.1.1.2.1.1.4", "In Progress Invocations");
    expect(classifyIcd(icd, primRoot, docByDocNo)).toEqual({ kind: "invocation", status: "InProgress" });
  });

  it("returns null/null when the ICD isn't under the primitive root at all", () => {
    const icd = mkDoc("icd5", "A.6.1.1.9.2.1.1.2.1", "Test Instance Configuration Document");
    expect(classifyIcd(icd, primRoot, new Map())).toEqual({ kind: null, status: null });
  });

  it("returns null/null when no recognized tier title is found walking up", () => {
    const icd = mkDoc("icd6", "A.6.1.1.1.2.1.1.9.1", "Test Instance Configuration Document");
    const docByDocNo = tierMap("A.6.1.1.1.2.1.1.9", "Some Unrecognized Directory");
    expect(classifyIcd(icd, primRoot, docByDocNo)).toEqual({ kind: null, status: null });
  });
});

describe("buildChildrenIndex", () => {
  it("indexes direct children by parent doc_no", () => {
    const a = mkDoc("a", "A.1", "Scope");
    const b = mkDoc("b", "A.1.1", "Article");
    const c = mkDoc("c", "A.1.1.1", "Section");
    const d = mkDoc("d", "A.1.1.2", "Section Two");
    const idx = buildChildrenIndex([a, b, c, d]);
    expect(idx.get("A.1")?.map((n: { id: string }) => n.id)).toEqual(["b"]);
    expect(idx.get("A.1.1")?.map((n: { id: string }) => n.id)).toEqual(["c", "d"]);
  });

  it("skips top-level doc_nos with no dot (no parent to index under)", () => {
    const a = mkDoc("a", "A", "Root");
    const idx = buildChildrenIndex([a]);
    expect(idx.size).toBe(0);
  });
});

describe("extractInstanceParams", () => {
  const ICD_NO = "A.6.1.1.9.2.1.2.1";
  const PARAMS_NO = `${ICD_NO}.1`;

  const params_ = mkDoc("params", PARAMS_NO, "Parameters");
  const rewardCode = mkDoc("rc", `${PARAMS_NO}.1`, "Reward Code", { content: "`128`." });
  const subproxy = mkDoc("sp", `${PARAMS_NO}.2`, "SubProxy Account", {
    content: "The address of Test Agent's SubProxy Account on the Ethereum Mainnet is `0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.",
  });
  const genesis = mkDoc("ga", `${PARAMS_NO}.3`, "Genesis Account", {
    content: "The Genesis Account will be specified in a future iteration.",
  });
  const tokenAddr = mkDoc("ta", `${PARAMS_NO}.4`, "Token Address", {
    content:
      "The address of SPK on the Ethereum Mainnet is `0x1111111111111111111111111111111111111111`. The address of SPK on Base is `0x2222222222222222222222222222222222222222`.",
  });
  const rateLimits = mkDoc("rl", `${PARAMS_NO}.5`, "Inflow Rate Limits", {
    content: "The inflow rate limits are:\n\n- `maxAmount`: 200,000,000 USDS\n- `slope`: 400,000,000 USDS per day",
  });
  const rateLimitId = mkDoc("rlid", `${PARAMS_NO}.6`, "Inflow RateLimitID", {
    content: `The inflow RateLimitID is: \`0x${"1234567890abcdef".repeat(4)}\`.`,
  });
  const directoryLeaf = mkDoc("dl", `${PARAMS_NO}.7`, "Reserved Extension", {
    content: "The documents herein define reserved values.",
  });
  const ident = mkDoc("ident", `${PARAMS_NO}.8`, "Instance Identifiers");
  const identNetwork = mkDoc("identnet", `${PARAMS_NO}.8.1`, "Network", { content: "Solana." });
  const deploy = mkDoc("deploy", `${PARAMS_NO}.9`, "Deployment");
  const deployNetwork = mkDoc("deploynet", `${PARAMS_NO}.9.1`, "Network", { content: "Base." });
  const custom = mkDoc("custom", `${PARAMS_NO}.10`, "Custom Instance Parameters");
  const customChild = mkDoc("customchild", `${PARAMS_NO}.10.1`, "Should Not Appear", { content: "Ignored value." });

  const allDocs = [
    params_,
    rewardCode,
    subproxy,
    genesis,
    tokenAddr,
    rateLimits,
    rateLimitId,
    directoryLeaf,
    ident,
    identNetwork,
    deploy,
    deployNetwork,
    custom,
    customChild,
  ];
  const childrenByDocNo = buildChildrenIndex(allDocs);
  const icd = { doc_no: ICD_NO };
  const paramsResult = extractInstanceParams(icd, childrenByDocNo) as Record<string, [string, string, string]>;

  it("returns {} when there is no Parameters child", () => {
    expect(extractInstanceParams({ doc_no: "A.9.9.9" }, childrenByDocNo)).toEqual({});
  });

  it("unwraps a plain backtick leaf", () => {
    expect(paramsResult["Reward Code"]).toEqual(["128", "rc", `${PARAMS_NO}.1`]);
  });

  it("expands SubProxy Account into a chain-qualified key", () => {
    expect(paramsResult["SubProxy Account / Ethereum Mainnet"][0]).toBe(
      "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  });

  it("special-cases the 'will be specified' Genesis Account placeholder", () => {
    expect(paramsResult["Genesis Account"]).toEqual(["TBD", "ga", `${PARAMS_NO}.3`]);
  });

  it("expands multi-chain Token Address prose into per-chain keys", () => {
    expect(paramsResult["Token Address (Ethereum Mainnet)"][0]).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(paramsResult["Token Address (Base)"][0]).toBe("0x2222222222222222222222222222222222222222");
    expect(paramsResult["Token Address"]).toBeUndefined();
  });

  it("expands a generic backtick-bullet list into sub-keys", () => {
    expect(paramsResult["Inflow Rate Limits / maxAmount"][0]).toBe("200,000,000 USDS");
    expect(paramsResult["Inflow Rate Limits / slope"][0]).toBe("400,000,000 USDS per day");
    expect(paramsResult["Inflow Rate Limits"]).toBeUndefined();
  });

  it("dispatches a RateLimitID-shaped title to the hex extractor", () => {
    expect(paramsResult["Inflow RateLimitID"][0]).toBe(`0x${"1234567890abcdef".repeat(4)}`);
  });

  it("skips a directory-placeholder leaf entirely", () => {
    expect(paramsResult["Reserved Extension"]).toBeUndefined();
  });

  it("disambiguates a title collision with the parent title prefix, first writer keeps the bare key", () => {
    expect(paramsResult["Network"]).toEqual(["Solana", "identnet", `${PARAMS_NO}.8.1`]);
    expect(paramsResult["Deployment / Network"]).toEqual(["Base", "deploynet", `${PARAMS_NO}.9.1`]);
    expect(paramsResult["Instance Identifiers / Network"]).toBeUndefined();
  });

  it("skips the entire Custom Instance Parameters subtree", () => {
    expect(paramsResult["Should Not Appear"]).toBeUndefined();
    expect(Object.keys(paramsResult).some((k) => k.includes("Should Not Appear"))).toBe(false);
  });
});

// The *Address param formatters go through address-chains' canonical patterns.
// The load-bearing property (see the address-extraction skill) is the hex
// boundary: a 64-hex value — tx hash, bytes32, RateLimitID, all of which the
// atlas writes in the same backtick style — must never be truncated into a
// plausible-looking 40-hex "address".
describe("extractInstanceParams — address values", () => {
  const ICD_NO = "A.6.1.1.9.2.1.2.2";
  const P = `${ICD_NO}.1`;
  const HASH = `0x${"ab".repeat(32)}`; // 64 hex
  const ADDR = "0x1234567890abcdef1234567890abcdef12345678"; // 40 hex
  const SOL = "So11111111111111111111111111111111111111112"; // 43 base58
  const SHORT_B58 = "AaBbCcDdEeFfGgHhJjKkMmNnPpQqRrSs"; // 32 base58 chars — too short for a pubkey

  const docs = [
    mkDoc("p", P, "Parameters"),
    mkDoc("hash", `${P}.1`, "Address", { content: `The transaction hash is \`${HASH}\`.` }),
    mkDoc("bare", `${P}.2`, "Pool Address", { content: `The pool address is \`${ADDR}\`.` }),
    mkDoc("sol", `${P}.3`, "Allocator Role Address", { content: `The role address is \`${SOL}\`.` }),
    mkDoc("short", `${P}.4`, "Underlying Asset Address", { content: `The asset is \`${SHORT_B58}\`.` }),
    mkDoc("prose", `${P}.5`, "Integration Partner Reward Address", {
      content: `The reward address for the Aave Integration Boost is ${ADDR}.`,
    }),
  ];
  const idx = buildChildrenIndex(docs);
  const res = extractInstanceParams({ doc_no: ICD_NO }, idx) as Record<string, [string, string, string]>;

  it("never truncates a 64-hex value into a 40-hex address", () => {
    // Regression: the fallback used to be an un-anchored /0x[0-9a-fA-F]{40}/,
    // which matched the leading 40 hex of the hash and shipped it as an address.
    // Asserts the SHAPE, not one string: any 40-hex truncation must fail here.
    expect(res["Address"][0]).not.toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(res["Address"][0]).toContain(HASH);
  });

  it("keeps a backticked EVM address", () => {
    expect(res["Pool Address"][0]).toBe(ADDR);
  });

  it("keeps a backticked Solana pubkey", () => {
    expect(res["Allocator Role Address"][0]).toBe(SOL);
  });

  it("does not read a short base58-shaped token as an address", () => {
    // The Solana quantifier is the canonical {43,44}, not {32,44}: a 32-char
    // backticked word is a label or an identifier, never a pubkey.
    expect(res["Underlying Asset Address"][0]).not.toBe(SHORT_B58);
  });

  it("still finds a bare address in prose", () => {
    expect(res["Integration Partner Reward Address"][0]).toBe(ADDR);
  });
});
