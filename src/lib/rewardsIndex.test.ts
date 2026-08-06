import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildRewardsIndex, rewardsIndexToCSV } from "./rewardsIndex";
import type { RewardsAgent, RewardsIndex } from "./rewardsTypes";
import type { AtlasNode, GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graphData";

// Minimal agent with one DR instance (with reward code + params) and one IB
// invocation (partner + address). Exercises the flatten across primitive kinds,
// statuses (Active vs InProgress), and kind-specific columns.
const agent: RewardsAgent = {
  name: "Spark",
  docNoPrefix: "A.6.1.1.1.",
  agentEntity: { id: "spark", name: "Spark", slug: "spark" },
  chain: {
    executor: { id: "ozone", name: "Ozone", slug: "ozone" },
    govops: { id: "soter", name: "Soter Labs", slug: "soter-labs" },
  },
  dr: {
    kind: "DR",
    primitiveId: "dr-prim",
    primitiveDocNo: "A.6.1.1.1.2.5.1",
    globalActivation: "Active",
    active: [
      {
        id: "i1", docNo: "A.6.1.1.1.2.5.1.3.4.1", name: "stUSDS DR", status: "Active",
        rewardCode: "RC-01", tracking: "Methodology X",
        paymentsControllerDocNo: "A.6.1.1.1.2.5.1.3.4.1.0.6.1",
        paymentsResponsibleParty: { id: "soter", name: "Soter Labs", slug: "soter-labs" },
        params: { "Reward Code": ["RC-01", "u-rc", "A.6.1.1.1.2.5.1.3.4.1.1.1"] },
      },
    ],
    suspended: [],
    completed: [],
    invocations: [],
  },
  ib: {
    kind: "IB",
    primitiveId: "ib-prim",
    primitiveDocNo: "A.6.1.1.1.2.5.2",
    globalActivation: null,
    active: [],
    suspended: [],
    completed: [],
    invocations: [
      {
        id: "v1", docNo: "A.6.1.1.1.2.5.2.4.4.1", name: "Grove IB", status: "InProgress",
        partnerName: "Grove", rewardAddress: "0xabc", rewardChain: "ethereum", cadence: "monthly",
      },
    ],
  },
};

const idx: RewardsIndex = {
  agents: [agent],
  stUsdsDr: null, srUsdsDr: null, drPrimitive: null, ibPrimitive: null,
  demandSideBufferAddress: "0x000",
};

describe("rewardsIndexToCSV", () => {
  it("flattens instances + invocations across DR/IB with kind-specific columns", () => {
    const lines = rewardsIndexToCSV(idx).split("\r\n");
    expect(lines[0]).toBe(
      '"Agent","Executor","GovOps","Primitive","Primitive Doc","Primitive UUID","Primitive Link","Global Activation","Doc No","UUID","Atlas Link","Name","Status","Reward Code","Partner Name","Reward Address","Reward Chain","Cadence","Tracking","Payments Controller Doc","Payments Controller UUID","Payments Controller Link","Responsible Party","Params"',
    );
    expect(lines).toHaveLength(3); // header + 1 DR instance + 1 IB invocation

    // DR row: reward code + tracking + RP set; IB columns blank.
    const dr = lines[1];
    expect(dr).toContain('"Spark","Ozone","Soter Labs","Distribution Reward"');
    expect(dr).toContain('"Active"');
    expect(dr).toContain('"RC-01"');
    expect(dr).toContain('"Soter Labs"');
    expect(dr).toContain('"Reward Code=RC-01"'); // params joined

    // IB row: partner/address/chain/cadence set; status InProgress.
    const ib = lines[2];
    expect(ib).toContain('"Integration Boost"');
    expect(ib).toContain('"InProgress"');
    expect(ib).toContain('"Grove"');
    expect(ib).toContain('"0xabc"');
    expect(ib).toContain('"monthly"');
  });
});

// buildRewardsIndex against the real, already-built atlas artifacts — same
// convention as activeDataIndex.test.ts. The synthetic fixture above stays
// focused on rewardsIndexToCSV's flattening/escaping; these exercise the
// extraction logic (buildGraphCtx, resolveChain, extractPrimitive,
// applyParamTuples, extractIcdFromEntity) against real ICD content.

const ROOT = path.resolve(__dirname, "../..");
const PUBLIC = path.join(ROOT, "public");

type Relations = { entities: GraphEntity[]; edges: RelationEdge[] };

const relations: Relations = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "relations.json"), "utf8"),
);
const docs: Record<string, AtlasNode> = JSON.parse(
  fs.readFileSync(path.join(PUBLIC, "docs.json"), "utf8"),
).nodes;

const graph: GraphData = {
  participants: relations.entities.filter(
    (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
  ),
  instances: relations.entities.filter((e) => e.et === "instance"),
  invocations: relations.entities.filter((e) => e.et === "invocation"),
  primitives: relations.entities.filter((e) => e.et === "primitive"),
  edges: relations.edges,
};

describe("buildRewardsIndex — ecosystem nodes", () => {
  it("resolves the fixed ecosystem doc references by UUID, with a trimmed description", () => {
    const idx = buildRewardsIndex(docs, graph);
    for (const node of [idx.stUsdsDr, idx.srUsdsDr, idx.drPrimitive, idx.ibPrimitive]) {
      expect(node).not.toBeNull();
      const doc = docs[node!.id];
      expect(doc).toBeDefined();
      expect(node!.docNo).toBe(doc.doc_no);
      expect(node!.title).toBe(doc.title);
      expect(node!.description).toBe(doc.content.trim());
    }
    expect(idx.demandSideBufferAddress).toBe("0x5e2fec3a3c4e63a422e45c1bb83edb3a5ad0543b");
  });

  it("still resolves ecosystem nodes (which don't depend on the graph) when graph is omitted", () => {
    const idx = buildRewardsIndex(docs, undefined);
    expect(idx.agents).toEqual([]);
    expect(idx.stUsdsDr).not.toBeNull();
    expect(idx.drPrimitive).not.toBeNull();
  });
});

describe("buildRewardsIndex — agents", () => {
  const idx = buildRewardsIndex(docs, graph);
  const primes = graph.participants.filter((e) => e.et === "agent" && e.st === "prime");

  it("has exactly one RewardsAgent per prime agent with a resolvable defining doc", () => {
    expect(idx.agents.length).toBe(primes.length);
    expect(idx.agents.length).toBeGreaterThan(0);
  });

  it("agentEntity mirrors the source entity's id/name/slug", () => {
    for (const a of idx.agents) {
      const src = primes.find((p) => p.name === a.name)!;
      expect(a.agentEntity).toEqual({ id: src.id, name: src.name, slug: src.slug });
    }
  });

  it("docNoPrefix is the defining doc's doc_no plus a trailing dot", () => {
    for (const a of idx.agents) {
      const src = primes.find((p) => p.name === a.name)!;
      const doc = docs[src.did!];
      expect(a.docNoPrefix).toBe(`${doc.doc_no}.`);
    }
  });

  it("chain is built only from operational_* executor/govops edges (not core_*)", () => {
    for (const a of idx.agents) {
      const execEdge = relations.edges.find(
        (e) => e.e === "operational_executor_agent_for" && e.t === a.agentEntity!.id,
      );
      if (!execEdge) {
        expect(a.chain).toBeNull();
        continue;
      }
      expect(a.chain?.executor?.id).toBe(execEdge.f);
      const govEdge = relations.edges.find(
        (e) => e.e === "operational_govops_for" && e.t === execEdge.f,
      );
      expect(a.chain?.govops?.id ?? null).toBe(govEdge?.f ?? null);
    }
  });
});

describe("buildRewardsIndex — DR/IB extraction", () => {
  const idx = buildRewardsIndex(docs, graph);

  it("primitiveDocNo is the agent's doc_no + the DR/IB ICD-tier suffix", () => {
    for (const a of idx.agents) {
      if (a.dr) expect(a.dr.primitiveDocNo).toBe(`${a.docNoPrefix}2.5.1`);
      if (a.ib) expect(a.ib.primitiveDocNo).toBe(`${a.docNoPrefix}2.5.2`);
    }
  });

  it("buckets every DR/IB instance under active/suspended/completed matching its atlas status", () => {
    for (const a of idx.agents) {
      for (const prim of [a.dr, a.ib]) {
        if (!prim) continue;
        for (const icd of prim.active) expect(icd.status).toBe("Active");
        for (const icd of prim.suspended) expect(icd.status).toBe("Suspended");
        for (const icd of prim.completed) expect(icd.status).toBe("Completed");
        for (const icd of prim.invocations) expect(icd.status).toBe("InProgress");
      }
    }
  });

  it("DR instances carry a reward code and a resolved payments controller + responsible party", () => {
    const withActiveDr = idx.agents.find((a) => (a.dr?.active.length ?? 0) > 0)!;
    const icd = withActiveDr.dr!.active[0];
    expect(icd.rewardCode).toBeTruthy();
    expect(icd.rewardCodeDocId).toBeTruthy();
    expect(icd.paymentsControllerId).toBeTruthy();
    expect(icd.paymentsControllerDocNo).toBeTruthy();
    expect(icd.paymentsResponsibleParty?.name).toBeTruthy();
    // IB-only fields stay unset on a DR row.
    expect(icd.partnerName).toBeUndefined();
    expect(icd.rewardAddress).toBeUndefined();
  });

  it("IB instances carry partner/address/chain/cadence and never a DR payments controller", () => {
    const withActiveIb = idx.agents.find((a) => (a.ib?.active.length ?? 0) > 0)!;
    const icd = withActiveIb.ib!.active[0];
    expect(icd.partnerName).toBeTruthy();
    expect(icd.rewardAddress).toBeTruthy();
    expect(icd.rewardChain).toBeTruthy();
    expect(icd.cadence).toBeTruthy();
    expect(icd.paymentsControllerId).toBeUndefined();
    expect(icd.rewardCode).toBeUndefined();
  });

  it("tracking resolves through an embedded [title](uuid) link when present, else falls back to the raw ICD tuple", () => {
    let linked = false;
    let unlinked = false;
    for (const a of idx.agents) {
      for (const icd of [...(a.dr?.active ?? []), ...(a.dr?.invocations ?? []), ...(a.dr?.completed ?? [])]) {
        if (!icd.tracking) continue;
        if (/\]\([0-9a-f-]{36}\)/.test(icd.tracking)) {
          // Linked case: trackingDocId/Name resolve to the doc the link points at,
          // not the ICD's own Tracking Methodology sub-doc.
          expect(icd.trackingDocId).not.toBe(icd.rewardCodeDocId);
          expect(docs[icd.trackingDocId!]).toBeDefined();
          expect(icd.trackingDocNo).toBe(docs[icd.trackingDocId!].doc_no);
          linked = true;
        } else {
          unlinked = true;
        }
      }
    }
    expect(linked).toBe(true);
    expect(unlinked).toBe(true);
  });

  it("globalActivation reflects the primitive's .1.1 doc when present (both Active and Inactive occur)", () => {
    const values = new Set(idx.agents.flatMap((a) => [a.dr?.globalActivation, a.ib?.globalActivation]));
    expect(values.has("Active")).toBe(true);
    expect(values.has("Inactive")).toBe(true);
  });

  it("params carries every extracted parameter tuple keyed by its atlas label", () => {
    const withActiveDr = idx.agents.find((a) => (a.dr?.active.length ?? 0) > 0)!;
    const icd = withActiveDr.dr!.active[0];
    expect(icd.params?.["Reward Code"]?.[0]).toBe(icd.rewardCode);
  });
});

// Every real prime agent already has an operational executor/govops chain and
// both a DR and IB primitive doc, so resolveChain's null return and
// extractPrimitive's "no primitive doc at this doc_no" early-return are both
// unreachable from public data — exercised here against a minimal fixture.
describe("buildRewardsIndex — synthetic: no chain, no DR/IB primitive doc", () => {
  const primeDoc: AtlasNode = {
    id: "syn-prime", doc_no: "Z.9", title: "Lonely Agent", type: "Core",
    depth: 3, parentId: null, content: "", order: 0, addressRefs: [],
  };
  const synDocs: Record<string, AtlasNode> = { [primeDoc.id]: primeDoc };
  const primeEntity: GraphEntity = {
    id: "syn-prime", slug: "lonely-agent", name: "Lonely Agent", et: "agent", st: "prime", did: "syn-prime",
  };
  const synGraph: GraphData = {
    participants: [primeEntity],
    instances: [],
    invocations: [],
    primitives: [],
    edges: [],
  };

  it("chain is null with no operational_executor_agent_for/operational_govops_for edges", () => {
    const idx = buildRewardsIndex(synDocs, synGraph);
    expect(idx.agents).toHaveLength(1);
    expect(idx.agents[0].chain).toBeNull();
  });

  it("dr/ib are null when no primitive doc exists at the expected .2.5.1/.2.5.2 doc_no", () => {
    const idx = buildRewardsIndex(synDocs, synGraph);
    expect(idx.agents[0].dr).toBeNull();
    expect(idx.agents[0].ib).toBeNull();
  });
});
