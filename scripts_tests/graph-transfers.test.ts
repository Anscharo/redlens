// Unit tests for Pattern 18 transfer/grant event extraction
// (scripts/lib/graph-transfers.mjs). Real doc_nos/content are used where
// convenient (verified against public/docs.json); synthetic fixtures cover
// the warn/gate branches that don't have a naturally-occurring atlas example.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractTransfers } from "../scripts/lib/graph-transfers.mjs";

function entity(slug: string, name: string, entity_type = "ecosystem_actor", subtype: string | null = null): any {
  return { id: slug, slug, name, entity_type, subtype, defining_doc_id: null, is_active: 1, meta: null };
}

function doc(id: string, doc_no: string, title: string, content: string): any {
  return { id, doc_no, title, type: "Core", content };
}

function run(docs: any[], entityMap: Map<string, any>, edges: any[] = []) {
  const addEntity = (
    slug: string,
    name: string,
    entity_type: string,
    subtype: string | null,
    defining_doc_id: string | null,
    meta: unknown,
  ) => {
    const ent = { ...entity(slug, name, entity_type, subtype), defining_doc_id, meta: meta ? JSON.stringify(meta) : null };
    entityMap.set(slug, ent);
    return ent;
  };
  const docById = new Map(docs.map((d) => [d.id, d]));
  const docByDocNo = new Map(docs.map((d) => [d.doc_no, d]));
  const stats = extractTransfers(docs, docById, docByDocNo, entityMap, edges, addEntity);
  return { stats, edges };
}

function skyCoreMap(...extra: [string, any][]) {
  return new Map<string, any>([["sky-core", entity("sky-core", "Sky Core", "operational_party")], ...extra]);
}

describe("extractTransfers — Shape A: A.2.13 grant docs", () => {
  it("extracts a disbursed grant with amounts, tx hash, and recipient address", () => {
    // A.2.13.1.1.1 "August 2025 Grant" (real atlas content).
    const d = doc(
      "grant-1",
      "A.2.13.1.1.1",
      "August 2025 Grant",
      "The approved and disbursed August 2025 grant to the Sky Frontier Foundation is as follows:\n\n- Recipient: Sky Frontier Foundation\n- Recipient Address: `0xca5183FB9997046fbd9bA8113139bf5a5Af122A0`\n- Transaction Hash: `0x9dff3cf283969f0d6b54347829463aabbcad43e79ebb7ad20c5154e951586e3f`\n- USDS amount: 50,000,000",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.grants).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: "sky-core", edgeType: "funds_transfer", sourceDocNos: ["A.2.13.1.1.1"] });
    const meta = JSON.parse(edges[0].meta);
    expect(meta).toMatchObject({
      kind: "grant",
      status: "disbursed",
      period: "August 2025",
      recipient_address: "0xca5183fb9997046fbd9ba8113139bf5a5af122a0",
      tx_hash: "0x9dff3cf283969f0d6b54347829463aabbcad43e79ebb7ad20c5154e951586e3f",
    });
    expect(meta.amounts).toEqual({ USDS: "50,000,000" });
  });

  it("warns and skips a grant doc with no Recipient line", () => {
    const d = doc("grant-2", "A.2.13.1.3.1", "January 2026 Grant", "The grant amounts are still being finalized.");
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.grants).toBe(0);
    expect(stats.warnings).toBe(1);
    expect(edges).toEqual([]);
  });

  it("warns but still records the transfer for a grant doc with no amount bullets", () => {
    const d = doc(
      "grant-3",
      "A.2.13.1.3.2",
      "February 2026 Grant",
      "The approved grant is as follows:\n\n- Recipient: Sky Fortification Foundation",
    );
    const entityMap = skyCoreMap();
    const { stats, edges } = run([d], entityMap);
    expect(stats.grants).toBe(1);
    expect(stats.warnings).toBe(1);
    expect(edges).toHaveLength(1);
    expect(JSON.parse(edges[0].meta).amounts).toEqual({});
    expect(JSON.parse(edges[0].meta).status).toBe("approved");
  });
});

describe("extractTransfers — Shape B: genesis token distributions", () => {
  const spark = entity("spark", "Spark", "agent", "prime");
  const agentDoc = doc("agent-spark", "A.6.1.1.1", "Spark", "");

  it("extracts a genesis mint event, resolving the agent via the ICD doc_no prefix", () => {
    const d = doc(
      "mint-1",
      "A.6.1.1.1.2.1.4.2.1.2.1",
      "Minting Of Tokens To SPK Company Ltd",
      "The Genesis Supply was minted to an account owned by SPK Company Ltd.",
    );
    const entityMap = skyCoreMap(["spark", spark]);
    const { stats, edges } = run([agentDoc, d], entityMap);
    expect(stats.genesis).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0].fromId).toBe("spark");
    const created = entityMap.get("spk-company-ltd");
    expect(created?.entity_type).toBe("ecosystem_actor");
    expect(JSON.parse(edges[0].meta)).toEqual({ kind: "genesis_mint", status: "completed" });
  });

  it("warns when the owning agent doc isn't in the corpus", () => {
    const d = doc(
      "mint-2",
      "A.6.1.1.99.2.1.4.2.1.2.1",
      "Minting Of Tokens To Foo Ltd",
      "The Genesis Supply was minted to an account owned by Foo Ltd.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.genesis).toBe(0);
    expect(stats.warnings).toBe(1);
    expect(edges).toEqual([]);
  });

  it("extracts a completed genesis transfer aliasing 'Sky Pause Proxy' to sky-core", () => {
    // A.6.1.1.1.2.1.4.2.1.2.2 (real atlas content, markdown citation link included).
    const d = doc(
      "xfer-1",
      "A.6.1.1.1.2.1.4.2.1.2.2",
      "Transfer Of Tokens To Sky",
      "SPK Company Ltd transferred 6.5 billion SPK tokens from the SPK Company Ltd account to the Sky Pause Proxy. The SPK Company Ltd account is specified in [A.6.1.1.1.2.1.4.2.1.2.1 - Minting Of Tokens To SPK Company Ltd](8b3b46b1-e16a-4d1a-b4d0-52b4cc01ca4f).",
    );
    const entityMap = skyCoreMap(["spark", spark]);
    const { stats, edges } = run([agentDoc, d], entityMap);
    expect(stats.genesis).toBe(1);
    expect(stats.planned).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0].toId).toBe("sky-core");
    const meta = JSON.parse(edges[0].meta);
    expect(meta).toMatchObject({ kind: "genesis", status: "completed" });
    expect(meta.amounts).toEqual({ SPK: "6.5 billion" });
    // The sender was created fresh from prose, matching the census verdict
    // that SPK Company Ltd surfaces as an ecosystem_actor (parse-atlas skill).
    expect(entityMap.get("spk-company-ltd")?.entity_type).toBe("ecosystem_actor");
  });

  it("marks a 'will transfer' sentence as planned", () => {
    const d = doc(
      "xfer-2",
      "A.6.1.1.2.2.1.4.2.1.2.2",
      "Transfer Of Tokens To Sky",
      "Grove Foundation will transfer 1,000,000 GROVE tokens from the Grove Foundation account to the Sky Pause Proxy.",
    );
    const entityMap = skyCoreMap();
    const { stats, edges } = run([d], entityMap);
    expect(stats.genesis).toBe(1);
    expect(stats.planned).toBe(1);
    expect(JSON.parse(edges[0].meta).status).toBe("planned");
  });

  it("resolves a SubProxy-account sender via trailingProperNoun after a lower-case lead-in", () => {
    const d = doc(
      "xfer-3",
      "A.6.1.1.1.2.1.4.2.1.2.5",
      "Transfer Of Tokens To Sky Core",
      "Following genesis, the Spark SubProxy Account transferred 500,000 SPK tokens to Sky Core.",
    );
    const entityMap = skyCoreMap(["spark", spark]);
    const { stats, edges } = run([d], entityMap);
    expect(stats.genesis).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges[0].fromId).toBe("spark");
    expect(edges[0].toId).toBe("sky-core");
  });

  it("warns when a genesis-titled doc's content matches no transfer shape", () => {
    const d = doc("xfer-4", "A.6.1.1.1.2.1.4.2.1.2.6", "Transfer Of Tokens For Reserve", "Tokens moved without further detail.");
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.warnings).toBe(1);
    expect(edges).toEqual([]);
  });

  it("skips a directory doc even when its title matches the genesis shape", () => {
    const d = doc(
      "xfer-5",
      "A.6.1.1.1.2.1.4.2.1.2",
      "Transfer Of Tokens Directory",
      "The documents herein record every SPK genesis token movement.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.genesis).toBe(0);
    expect(stats.warnings).toBe(0);
    expect(edges).toEqual([]);
  });

  it("records a planned distribution that defers its details as a data gap", () => {
    // A.6.1.1.1.2.1.4.2.1.2.4 "Transfer Of Tokens For Token Launch" (real atlas content).
    const d = doc(
      "xfer-6",
      "A.6.1.1.1.2.1.4.2.1.2.4",
      "Transfer Of Tokens For Token Launch",
      "The SPK Company Ltd account will transfer SPK tokens in connection with the token launch.\n\nThe amount and nature of these distributions will be specified in a future iteration of the Spark Artifact.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.dataGaps).toBe(1);
    expect(stats.planned).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: "xfer-6", fromType: "doc", edgeType: "funds_data_gap" });
    expect(JSON.parse(edges[0].meta)).toMatchObject({ kind: "planned_genesis_distribution_gap", status: "planned", token: "SPK" });
  });
});

describe("extractTransfers — Shape C: grant authorizations", () => {
  it("warns when a grant-authorization-titled doc doesn't match the sentence shape", () => {
    const d = doc(
      "auth-1",
      "A.2.8.2.2.2.4.5.1.4",
      "Spark Foundation Grant Authorization: Q3 2026",
      "This authorization is still under discussion and has no finalized terms.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.authorizations).toBe(0);
    expect(stats.warnings).toBe(1);
    expect(edges).toEqual([]);
  });

  it("skips a real directory doc under a Grant Authorizations section", () => {
    // A.2.8.2.2.2.4.5.1 (real atlas content).
    const d = doc(
      "auth-2",
      "A.2.8.2.2.2.4.5.1",
      "Spark Foundation Grant Authorizations",
      "The documents herein record Sky Governance authorizations for grants to the Spark Foundation.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.authorizations).toBe(0);
    expect(stats.warnings).toBe(0);
    expect(edges).toEqual([]);
  });

  it("extracts a recurring per-month grant authorization with its begin date and period", () => {
    // A.2.8.2.2.2.4.5.1.1 "Spark Foundation Grant Authorization: October 2025" (real atlas content, trimmed).
    const spark = entity("spark", "Spark", "agent", "prime");
    const d = doc(
      "auth-3",
      "A.2.8.2.2.2.4.5.1.1",
      "Spark Foundation Grant Authorization: October 2025",
      "The founding team of Spark has proposed a cash grant of 1,100,000 USDS per month to the Spark Foundation from Spark's Prime Treasury for a three (3) month period, beginning on October 1, 2025.",
    );
    const entityMap = skyCoreMap(["spark", spark]);
    const { stats, edges } = run([d], entityMap);
    expect(stats.authorizations).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: "spark", edgeType: "funds_authorization", sourceDocNos: ["A.2.8.2.2.2.4.5.1.1"] });
    const meta = JSON.parse(edges[0].meta);
    expect(meta).toMatchObject({
      periodic: true,
      period_months: 3,
      period: "October 2025",
      begin_date: "October 1, 2025",
    });
    expect(meta.amounts).toEqual({ "USDS per month": "1,100,000" });
    expect(entityMap.get("spark-foundation")?.entity_type).toBe("foundation");
  });
});

describe("extractTransfers — Shape D: accord capital allocations", () => {
  const spark = entity("spark", "Spark", "agent", "prime");

  it("extracts the simple allocation sentence with status=allocated", () => {
    // A.2.8.2.2.2.4.1 "Spark Initial Allocation" (real atlas content).
    const d = doc("alloc-1", "A.2.8.2.2.2.4.1", "Spark Initial Allocation", "The Initial Allocation for Spark is 25,000,000 USDS.");
    const entityMap = skyCoreMap(["spark", spark]);
    const { stats, edges } = run([d], entityMap);
    expect(stats.allocations).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges[0].fromId).toBe("sky-core");
    expect(edges[0].toId).toBe("spark");
    const meta = JSON.parse(edges[0].meta);
    expect(meta).toMatchObject({ kind: "allocation", allocation_type: "initial", status: "allocated" });
    expect(meta.amounts).toEqual({ USDS: "25,000,000" });
  });

  it("marks a scheduled genesis capital allocation as planned with the vote citation", () => {
    // A.2.8.2.3.2.3 (real atlas content, trimmed).
    const keel = entity("keel", "Keel", "agent", "prime");
    const d = doc(
      "alloc-2",
      "A.2.8.2.3.2.3",
      "Genesis Capital Allocation",
      "The Genesis Capital Allocation for Keel is 10,000,000 USDS. The transfer of the Genesis Capital Allocation to Keel will be included in the March 26, 2026 Executive Vote.",
    );
    const entityMap = skyCoreMap(["keel", keel]);
    const { stats, edges } = run([d], entityMap);
    expect(stats.allocations).toBe(1);
    const meta = JSON.parse(edges[0].meta);
    expect(meta).toMatchObject({ allocation_type: "genesis_capital", status: "planned", scheduled: "March 26, 2026 Executive Vote" });
  });

  it("warns when the allocation recipient doesn't resolve to an existing entity", () => {
    const d = doc("alloc-3", "A.2.8.2.9.2.4.1", "Nowhere Initial Allocation", "The Initial Allocation for Nowhere is 1,000,000 USDS.");
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.allocations).toBe(0);
    expect(stats.warnings).toBe(1);
    expect(edges).toEqual([]);
  });

  it("skips a directory doc whose title still matches the allocation suffix gate", () => {
    // A.2.8.2.4.2.1 (real atlas content).
    const d = doc(
      "alloc-4",
      "A.2.8.2.4.2.1",
      "Genesis Capital Allocation",
      "The subdocuments herein set out agreed terms with respect to Genesis Capital Allocation.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.allocations).toBe(0);
    expect(edges).toEqual([]);
  });

  it("warns when neither the simple sentence nor the enumerated form parses", () => {
    const d = doc("alloc-5", "A.2.8.2.9.2.4.2", "Osero Initial Allocation", "The allocation terms for Osero are pending negotiation.");
    const { stats } = run([d], skyCoreMap());
    expect(stats.allocations).toBe(0);
    expect(stats.warnings).toBe(1);
  });

  it("extracts the enumerated 'shall directly transfer' form, one edge per item, retrying the Multisig suffix on resolve-only lookups", () => {
    // A.2.8.2.5.2.2 (real atlas content, incl. a markdown citation link that
    // must be stripped before matching).
    const cce1 = entity("core-council-executor-agent-1", "Core Council Executor Agent 1", "agent", "core_executor");
    const buffer = entity("core-council-buffer-multisig", "Core Council Buffer Multisig", "multisig");
    const d = doc(
      "alloc-6",
      "A.2.8.2.5.2.2",
      "Genesis Capital Allocation",
      "To effect the Genesis Capitalization of Core Council Executor Agent 1, Sky Core shall directly transfer (1) 20,000,000 USDS to the Core Council Executor Agent 1 SubProxy and (2) 5,000,000 USDS to the Core Council Buffer (see [A.2.3.1.2.2.2.1 - Core Council Buffer](8b6781d7-f35c-4ffe-b8ed-299fa98e3da7)).",
    );
    const entityMap = skyCoreMap(
      ["core-council-executor-agent-1", cce1],
      ["core-council-buffer-multisig", buffer],
    );
    const { stats, edges } = run([d], entityMap);
    expect(stats.allocations).toBe(2);
    expect(edges).toHaveLength(2);
    expect(edges[0]).toMatchObject({ fromId: "sky-core", toId: "core-council-executor-agent-1" });
    expect(JSON.parse(edges[0].meta).amounts).toEqual({ USDS: "20,000,000" });
    // rawRecipient ("… SubProxy") differs from the resolved entity's own
    // name ("Core Council Executor Agent 1") — the mismatch is recorded.
    expect(JSON.parse(edges[0].meta).account).toBe("Core Council Executor Agent 1 SubProxy");
    expect(edges[1]).toMatchObject({ fromId: "sky-core", toId: "core-council-buffer-multisig" });
    expect(JSON.parse(edges[1].meta).amounts).toEqual({ USDS: "5,000,000" });
    // Same mismatch: prose said "Core Council Buffer", resolved via the
    // Multisig-suffix retry to "Core Council Buffer Multisig".
    expect(JSON.parse(edges[1].meta).account).toBe("Core Council Buffer");
  });
});

describe("extractTransfers — Shape E: executed budget transfers", () => {
  const spark = entity("spark", "Spark", "agent", "prime");

  it("extracts a budget transfer with no title gate, using resolve-only endpoints", () => {
    // A.2.8.2.2.2.7.4.1 (real atlas content).
    const d = doc(
      "budget-1",
      "A.2.8.2.2.2.7.4.1",
      "Transfer From Liquidity Bootstrapping Budget To Spark For Market Makers",
      "Sky has transferred 2 million USDS from the Sky Ecosystem Liquidity Bootstrapping Budget to Spark to provide liquidity to market makers.",
    );
    const entityMap = skyCoreMap(["spark", spark]);
    const { stats, edges } = run([d], entityMap);
    expect(stats.budgetTransfers).toBe(1);
    expect(stats.warnings).toBe(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: "sky-core", toId: "spark", edgeType: "funds_transfer" });
    const meta = JSON.parse(edges[0].meta);
    expect(meta).toMatchObject({
      kind: "budget_transfer",
      status: "completed",
      source_budget: "Sky Ecosystem Liquidity Bootstrapping Budget",
    });
    expect(meta.amounts).toEqual({ USDS: "2 million" });
  });

  it("warns when a budget-transfer sentence's endpoints don't resolve (never created)", () => {
    const d = doc(
      "budget-2",
      "A.2.8.2.9.2.7.4.1",
      "Transfer From Somewhere To Nowhere",
      "Nobody has transferred 3 million USDS from the Nowhere Budget to Nobody.",
    );
    const { stats, edges } = run([d], skyCoreMap());
    expect(stats.budgetTransfers).toBe(0);
    expect(stats.warnings).toBe(1);
    expect(edges).toEqual([]);
  });
});
