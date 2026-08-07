// Fixtures for the worker-side tests. Small, hand-built atlas + graph datasets
// shaped to exercise every branch the workers care about (scope/agent/ICD
// labels, chainlog reverse lookup, address refs, tickers, phrases, doc_no and
// UUID fast-paths, entity/edge resolution, agent clusters). Deterministic ids so
// tests can assert exact hits without depending on the real multi-MB artifacts.

import MiniSearch from "minisearch";
import { MINISEARCH_OPTIONS } from "../lib/searchOptions";
import type { AtlasNode, AddressInfo, GraphEntity, RelationEdge } from "../types";

// Full 36-char UUIDs with memorable 8-hex prefixes for the prefix fast-path.
export const IDS = {
  scope: "aaaaaaaa-1111-4111-8111-000000000001", // A.1 scope root
  facilitatorCore: "bbbbbbbb-2222-4222-8222-000000000002", // A.1.2 Core (has address)
  scenarioVar: "cccccccc-3333-4333-8333-000000000003", // A.1.2.1.var1
  agentRoot: "dddddddd-4444-4444-8444-000000000004", // A.6.1.1.1 Prime Agent
  agentIcd: "eeeeeeee-5555-4555-8555-000000000005", // ICD under the agent
  agentChild: "ffffffff-6666-4666-8666-000000000006", // deep child under the ICD
  annotation: "a1b2c3d4-7777-4777-8777-000000000007", // A.1.2.0.3.1 Annotation
  // References the MCD_VAT address but never spells "MCD_VAT" in its text — a
  // chainlog match with no text match (chainlog-only merge tier).
  addrOnly: "d00d0000-8888-4888-8888-000000000008", // A.4.1
  // Two docs sharing an 8-hex prefix so a UUID-prefix query returns >1 and sorts.
  prefixA: "abcabc12-9999-4999-8999-000000000009",
  prefixB: "abcabc12-9999-4999-8999-00000000000a",
} as const;

const ADDR = "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b"; // MCD_VAT-ish

export function makeDocsRecord(): Record<string, AtlasNode> {
  const nodes: AtlasNode[] = [
    {
      id: IDS.scope,
      doc_no: "A.1",
      title: "Governance & Scope", // '&' exercises the title HTML-escape path
      type: "Scope",
      depth: 2,
      parentId: null,
      content: "The governance scope defines alignment and delegate structures.",
      order: 0,
      addressRefs: [],
    },
    {
      id: IDS.facilitatorCore,
      doc_no: "A.1.2",
      title: "Facilitator Quorum",
      type: "Core",
      depth: 3,
      parentId: IDS.scope,
      content:
        "The Facilitator role is bound to MCD_VAT at " +
        ADDR +
        ". USDC transfers require a delegatedSigners quorum. properly implemented.",
      order: 1,
      addressRefs: [ADDR],
    },
    {
      id: IDS.scenarioVar,
      doc_no: "A.1.2.1.var1",
      title: "Delegate Slippery Scenario",
      type: "Scenario Variation",
      depth: 5,
      parentId: IDS.facilitatorCore,
      content: "A slippery misalignment scenario where a delegate acts alone.",
      order: 2,
      addressRefs: [],
    },
    {
      id: IDS.annotation,
      doc_no: "A.1.2.0.3.1",
      title: "Facilitator Annotation",
      type: "Annotation",
      depth: 4,
      parentId: IDS.facilitatorCore,
      content: "Governance annotation clarifying the facilitator quorum.",
      order: 3,
      addressRefs: [],
    },
    {
      id: IDS.agentRoot,
      doc_no: "A.6.1.1.1",
      title: "Operational Executor Agent Skybase",
      type: "Active Data Controller",
      depth: 5,
      parentId: null,
      content: "Skybase is a prime agent in the agents scope.",
      order: 4,
      addressRefs: [],
    },
    {
      id: IDS.agentIcd,
      doc_no: "A.6.1.1.1.3",
      title: "Skybase Instance Configuration Document",
      type: "Type Specification",
      depth: 6,
      parentId: IDS.agentRoot,
      content: "Skybase ICD with universal parameters.",
      order: 5,
      addressRefs: [],
    },
    {
      id: IDS.agentChild,
      doc_no: "A.6.1.1.1.3.2",
      title: "Skybase Reward Instance",
      type: "Active Data",
      depth: 6,
      parentId: IDS.agentIcd,
      content: "A reward instance governed by the Skybase agent.",
      order: 6,
      addressRefs: [],
    },
    {
      id: IDS.addrOnly,
      doc_no: "A.4.1",
      title: "Vat Address Holder",
      type: "Core",
      depth: 3,
      parentId: null,
      content: "This document references the vat contract at " + ADDR + " directly.",
      order: 7,
      addressRefs: [ADDR],
    },
    {
      id: IDS.prefixA,
      doc_no: "A.3.2",
      title: "Prefix Doc Two",
      type: "Core",
      depth: 3,
      parentId: null,
      content: "Second prefix-sharing document.",
      order: 8,
      addressRefs: [],
    },
    {
      id: IDS.prefixB,
      doc_no: "A.3.1",
      title: "Prefix Doc One",
      type: "Core",
      depth: 3,
      parentId: null,
      content: "First prefix-sharing document.",
      order: 9,
      addressRefs: [],
    },
  ];
  const rec: Record<string, AtlasNode> = {};
  for (const n of nodes) rec[n.id] = n;
  return rec;
}

export function makeAddresses(): Record<string, AddressInfo> {
  return {
    [ADDR]: {
      chain: "ethereum",
      chains: ["ethereum"],
      explorerUrl: "https://etherscan.io/address/" + ADDR,
      label: "MCD_VAT",
      chainlogId: "MCD_VAT",
      isContract: true,
      isProxy: false,
      roles: [],
      aliases: [],
      expectedTokens: [],
    },
  };
}

export const MCD_VAT_ADDR = ADDR;

/** Serialize a real MiniSearch index over the fixture docs — the search worker
 *  loads this via loadJSON, so it exercises the genuine index/query path. */
export function makeSearchIndexJson(docs = makeDocsRecord()): string {
  const ms = new MiniSearch(MINISEARCH_OPTIONS);
  ms.addAll(Object.values(docs));
  return JSON.stringify(ms.toJSON());
}

// --- graph fixtures ---------------------------------------------------------

export const G = {
  primeAgent: "aaaaaaaa-0000-4000-8000-0000000000a1",
  execAgent: "bbbbbbbb-0000-4000-8000-0000000000b1",
  facilitator: "cccccccc-0000-4000-8000-0000000000c1",
  govops: "dddddddd-0000-4000-8000-0000000000d1",
  composite: "eeeeeeee-0000-4000-8000-0000000000e1",
  instance: "ffffffff-0000-4000-8000-0000000000f1",
  primitive: "99999999-0000-4000-8000-000000000091",
  docId: "12345678-0000-4000-8000-000000000012", // a plain doc node (not an entity)
} as const;

export function makeEntities(): GraphEntity[] {
  return [
    { id: G.primeAgent, slug: "skybase", name: "Skybase", et: "agent", st: "prime", did: G.primeAgent },
    { id: G.execAgent, slug: "ozone", name: "Ozone", et: "agent", st: "operational_executor", did: G.execAgent },
    { id: G.facilitator, slug: "steakhouse", name: "Steakhouse", et: "facilitator_org", st: null, did: G.facilitator },
    { id: G.govops, slug: "govalpha", name: "GovAlpha", et: "govops_org", st: null, did: G.govops },
    { id: G.composite, slug: "sky-foundation", name: "Sky Foundation", et: "composite_party", st: null, did: null },
    { id: G.instance, slug: "usds-reward", name: "USDS Reward", et: "instance", st: "reward", did: null },
    { id: G.primitive, slug: "reward-primitive", name: "Reward Primitive", et: "primitive", st: "reward", did: null },
  ];
}

export function makeEdges(): RelationEdge[] {
  return [
    // prime → executor
    { f: G.execAgent, ft: "entity", t: G.primeAgent, tt: "entity", e: "operational_executor_agent_for", s: ["A.6.1.1.1"] },
    // executor → facilitator (a role edge that pulls facilitator into the cluster)
    { f: G.facilitator, ft: "entity", t: G.execAgent, tt: "entity", e: "operational_facilitator_for", s: ["A.1.2"] },
    // executor → govops
    { f: G.govops, ft: "entity", t: G.execAgent, tt: "entity", e: "operational_govops_for" },
    // prime comprises a composite party
    { f: G.primeAgent, ft: "entity", t: G.composite, tt: "entity", e: "comprises" },
    // instance governed by prime (entity→entity, non-role)
    { f: G.instance, ft: "entity", t: G.primeAgent, tt: "entity", e: "governed_by", m: '{"status":"active"}' },
    // entity → doc edge (mixed types, exercises resolveEdge doc branch)
    { f: G.primeAgent, ft: "entity", t: G.docId, tt: "doc", e: "defined_in", s: ["A.6.1.1.1"] },
    // doc → address edge (neither endpoint is an entity)
    { f: G.docId, ft: "doc", t: "addr:ethereum", tt: "address", e: "has_address" },
  ];
}

export function makeRelationsJson(): string {
  return JSON.stringify({ entities: makeEntities(), edges: makeEdges() });
}
