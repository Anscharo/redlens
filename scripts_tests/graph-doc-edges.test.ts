// Unit tests for Phase 2 doc-structure edge extraction (2a–2h,
// scripts/lib/graph-doc-edges.mjs). One shared fixture tree mirrors the
// A.6.1.1.X.2.G.P primitive-root shape from the parse-atlas skill
// (Pattern 2 / Pattern 14), exercising every edge type in one pass.
//
// Doc ids must be UUID-shaped: extractDocEdges resolves `cites`, `implements`,
// and `located_at` via UUID_LINK_RE / IMPLEMENTS_RE markdown links, both of
// which require the 8-4-4-4-12 hex shape.

import { describe, it, expect } from "vitest";
// @ts-expect-error — .mjs without types; runtime-only import.
import { extractDocEdges } from "../scripts/lib/graph-doc-edges.mjs";

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

const uid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const CURRENT_PRIMITIVES_UUID = "203b8c79-c7cf-4fcc-94e3-5bf42f791619";

// --- Current Primitives registry (marks the primitive as "known") ---
const currentPrimitives = mkDoc(CURRENT_PRIMITIVES_UUID, "A.2.2.1", "Current Primitives", {
  content: "Genesis Primitives\n  - Test Distribution Reward Primitive\n",
});

// --- Global primitive definition (target of `implements`) ---
const globalDef = mkDoc(uid(1), "A.2.2.5.1", "Distribution Reward Primitive");

// --- Prime Agent ---
const agentDoc = mkDoc(uid(2), "A.6.1.1.1", "Test Prime Agent");

// --- Primitive root (X=1, G=1, P=1) ---
const primRoot = mkDoc(uid(3), "A.6.1.1.1.2.1.1", "Test Distribution Reward Primitive", {
  parentId: agentDoc.id,
  content: `This document specifies the primitive. See [Distribution Reward Primitive](${globalDef.id}).`,
});
const hub = mkDoc(uid(4), "A.6.1.1.1.2.1.1.1", "Primitive Hub Document", { parentId: primRoot.id });
const globalStatus = mkDoc(uid(5), "A.6.1.1.1.2.1.1.1.1", "Global Activation Status", {
  parentId: hub.id,
  content: "`Active`",
});
const activeTier = mkDoc(uid(6), "A.6.1.1.1.2.1.1.2", "Active Instances", { parentId: primRoot.id });
const icdActive = mkDoc(uid(7), "A.6.1.1.1.2.1.1.2.1", "Test Instance Configuration Document", {
  parentId: activeTier.id,
});
const icdLocation = mkDoc(uid(8), "A.6.1.1.1.2.1.1.1.2", "Test Instance Configuration Document Location", {
  parentId: hub.id,
  content: `This Instance's associated Instance Configuration Document is located at [Test ICD](${icdActive.id}).`,
});
const invocationTier = mkDoc(uid(9), "A.6.1.1.1.2.1.1.4", "In Progress Invocations", { parentId: primRoot.id });
const icdInvocation = mkDoc(
  uid(10),
  "A.6.1.1.1.2.1.1.4.1",
  "Test Invocation Instance Configuration Document",
  { parentId: invocationTier.id },
);

// --- Annotation (2b) ---
const annotation = mkDoc(uid(11), "A.6.1.1.1.2.1.1.0.3.1", "Test Annotation", { parentId: primRoot.id });

// --- Active Data Controller + Active Data (2c) ---
const controller = mkDoc(uid(12), "A.6.1.1.1.3.5", "Test Active Data Controller", {
  type: "Active Data Controller",
  parentId: agentDoc.id,
});
const activeData = mkDoc(uid(13), "A.6.1.1.1.3.5.0.6.1", "Test Active Data", {
  type: "Active Data",
  parentId: controller.id,
});

// --- cites (2d), with a duplicate link to test dedup ---
const citer = mkDoc(uid(14), "A.9.9.9", "Test Citer", {
  content: `See also [Some Ref](${globalDef.id}) and again [Some Ref](${globalDef.id}).`,
});

// --- unknown-primitive branch: a second, un-registered primitive ---
const primRoot2 = mkDoc(uid(15), "A.6.1.1.1.2.2.1", "Test Unknown Primitive");
const activeTier2 = mkDoc(uid(16), "A.6.1.1.1.2.2.1.2", "Active Instances", { parentId: primRoot2.id });
const icdActive2 = mkDoc(uid(17), "A.6.1.1.1.2.2.1.2.1", "Another Instance Configuration Document", {
  parentId: activeTier2.id,
});

// --- decoy: primitive root whose title doesn't end in "Primitive" (skip) ---
const primRoot3 = mkDoc(uid(18), "A.6.1.1.1.2.3.1", "Test Non Primitive Thing");
const icd3 = mkDoc(uid(19), "A.6.1.1.1.2.3.1.2.1", "Yet Another Instance Configuration Document");

// --- decoy: ICD outside the A.6.1.1. subtree (excluded by the top-level filter) ---
const icd4 = mkDoc(uid(20), "A.2.5.9.9", "Stray Instance Configuration Document");

const allDocs = [
  currentPrimitives,
  globalDef,
  agentDoc,
  primRoot,
  hub,
  globalStatus,
  activeTier,
  icdActive,
  icdLocation,
  invocationTier,
  icdInvocation,
  annotation,
  controller,
  activeData,
  citer,
  primRoot2,
  activeTier2,
  icdActive2,
  primRoot3,
  icd3,
  icd4,
];
const docById = new Map(allDocs.map((d) => [d.id, d]));
const docByDocNo = new Map(allDocs.map((d) => [d.doc_no, d]));
const agentEntity = {
  id: "agent-entity-1",
  slug: "test-prime-agent",
  name: "Test Prime Agent",
  entity_type: "agent",
  subtype: "prime",
};
const entityByDocId = new Map([[agentDoc.id, agentEntity]]);

const edges = extractDocEdges(allDocs, docById, docByDocNo, entityByDocId) as Array<{
  fromId: string;
  fromType: string;
  toId: string;
  toType: string;
  edgeType: string;
  sourceDocNos: string[];
  meta: string | null;
}>;
const byType = (t: string) => edges.filter((e) => e.edgeType === t);

describe("2a — parent_of", () => {
  it("emits an edge for every doc with a resolvable parentId", () => {
    const withParent = allDocs.filter((d) => d.parentId && docById.has(d.parentId as string));
    expect(byType("parent_of")).toHaveLength(withParent.length);
    expect(byType("parent_of").some((e) => e.fromId === agentDoc.id && e.toId === primRoot.id)).toBe(true);
  });
});

describe("2b — annotates", () => {
  it("links an annotation doc to its parent via the .0.3.N suffix", () => {
    const hits = byType("annotates");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fromId: annotation.id, toId: primRoot.id });
  });
});

describe("2c — active_data_for", () => {
  it("resolves the ADC by stripping the .0.6.N suffix", () => {
    const hits = byType("active_data_for");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fromId: activeData.id, toId: controller.id });
  });
});

describe("2d — cites", () => {
  it("dedups a duplicate UUID link within the same doc's content", () => {
    const hits = byType("cites").filter((e) => e.fromId === citer.id);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fromId: citer.id, toId: globalDef.id });
  });
});

describe("2e — implements", () => {
  it("links the primitive root to its global definition via the 'See [...]' cite", () => {
    const hits = byType("implements");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fromId: primRoot.id, toId: globalDef.id });
  });
});

describe("2f — instance_of / invocation_of", () => {
  it("emits instance_of with status Active for an ICD under Active Instances", () => {
    const hit = byType("instance_of").find((e) => e.fromId === icdActive.id);
    expect(hit).toBeTruthy();
    expect(hit!.toId).toBe(primRoot.id);
    expect(JSON.parse(hit!.meta!)).toEqual({ status: "Active" });
  });

  it("emits invocation_of with status InProgress for an ICD under In Progress Invocations", () => {
    const hit = byType("invocation_of").find((e) => e.fromId === icdInvocation.id);
    expect(hit).toBeTruthy();
    expect(hit!.toId).toBe(primRoot.id);
    expect(JSON.parse(hit!.meta!)).toEqual({ status: "InProgress" });
  });

  it("flags an unregistered primitive with is_unknown_primitive", () => {
    const hit = byType("instance_of").find((e) => e.fromId === icdActive2.id);
    expect(hit).toBeTruthy();
    expect(hit!.toId).toBe(primRoot2.id);
    expect(JSON.parse(hit!.meta!)).toMatchObject({ status: "Active", is_unknown_primitive: true });
  });

  it("skips an ICD whose primitive root title doesn't end in 'Primitive'", () => {
    expect(
      edges.some((e) => e.fromId === icd3.id && (e.edgeType === "instance_of" || e.edgeType === "invocation_of")),
    ).toBe(false);
  });

  it("excludes an ICD outside the A.6.1.1. subtree entirely", () => {
    expect(edges.some((e) => e.fromId === icd4.id)).toBe(false);
  });

  it("emits invoked_by from the instance ICD to its Prime Agent entity", () => {
    const hit = byType("invoked_by").find((e) => e.fromId === icdActive.id);
    expect(hit).toBeTruthy();
    expect(hit).toMatchObject({ fromType: "entity", toId: agentEntity.id, toType: "entity" });
    expect(JSON.parse(hit!.meta!)).toEqual({ status: "Active" });
  });
});

describe("2g — located_at", () => {
  it("links an ICD Location doc to the ICD it points at via UUID", () => {
    const hits = byType("located_at");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fromId: icdLocation.id, toId: icdActive.id });
  });
});

describe("2h — has_status", () => {
  it("links the primitive root to its Global Activation Status doc", () => {
    const hits = byType("has_status");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fromId: primRoot.id, toId: globalStatus.id });
  });
});
