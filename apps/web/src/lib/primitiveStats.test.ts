// Tests for the Radar primitive-stats data-shaping logic.
// Reads the built artifacts in /public — run `pnpm build:index && pnpm build:graph` first if stale.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { AtlasNode, GraphEntity, RelationEdge } from "@/types";
import type { GraphData } from "@/lib/graphData";
import { buildPrimitiveStats } from "./primitiveStats";

const CURRENT_PRIMITIVES_UUID = "203b8c79-c7cf-4fcc-94e3-5bf42f791619";

const ROOT = path.resolve(__dirname, "../../../..");
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

const canonicalCategoryNames = docs[CURRENT_PRIMITIVES_UUID].content
  .split("\n")
  .filter((l) => /^-\s/.test(l))
  .map((l) => l.replace(/^-\s+/, "").trim());

describe("buildPrimitiveStats — real atlas", () => {
  const stats = buildPrimitiveStats(graph, docs);
  const primes = graph.participants.filter((e) => e.et === "agent" && e.st === "prime");

  it("has one row per prime agent, sorted by defining-doc doc_no", () => {
    expect(stats.length).toBe(primes.length);
    expect(stats.length).toBeGreaterThan(0);
    const docNos = stats.map((s) => docs[s.docId]?.doc_no ?? "");
    const sorted = [...docNos].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    expect(docNos).toEqual(sorted);
  });

  it("every agent carries every canonical category, in canonical order", () => {
    for (const s of stats) {
      expect(s.categories.map((c) => c.title)).toEqual(
        expect.arrayContaining(canonicalCategoryNames),
      );
      expect(s.categories.slice(0, canonicalCategoryNames.length).map((c) => c.title)).toEqual(
        canonicalCategoryNames,
      );
    }
  });

  it("every canonical category carries a docId (seeded from a real primitive, or the global category doc)", () => {
    for (const s of stats) {
      for (const c of s.categories.slice(0, canonicalCategoryNames.length)) {
        expect(c.docId, `${s.name} / ${c.title}`).not.toBeNull();
      }
    }
  });

  it("resolves the operational executor for each prime agent, matching operational_executor_agent_for", () => {
    for (const s of stats) {
      const edge = relations.edges.find(
        (e) => e.e === "operational_executor_agent_for" && e.t === s.docId,
      );
      if (!edge) {
        expect(s.executorName).toBeNull();
        expect(s.executorSlug).toBeNull();
        continue;
      }
      const exec = graph.participants.find((p) => p.id === edge.f)!;
      expect(s.executorName).toBe(exec.name);
      expect(s.executorSlug).toBe(exec.slug);
    }
  });

  it("active/suspended/completed/invocation counts equal their parallel name-array lengths", () => {
    for (const s of stats) {
      for (const c of s.categories) {
        for (const p of c.primitives) {
          expect(p.active).toBe(p.activeNames.length);
          expect(p.suspended).toBe(p.suspendedNames.length);
          expect(p.completed).toBe(p.completedNames.length);
          expect(p.invocations).toBe(p.invocationNames.length);
        }
      }
    }
  });

  it("counts every real Active/Suspended/Completed instance exactly once, grouped by agent+primitive status", () => {
    const totalActive = stats.flatMap((s) => s.categories).flatMap((c) => c.primitives)
      .reduce((sum, p) => sum + p.active, 0);
    const totalSuspended = stats.flatMap((s) => s.categories).flatMap((c) => c.primitives)
      .reduce((sum, p) => sum + p.suspended, 0);
    const totalCompleted = stats.flatMap((s) => s.categories).flatMap((c) => c.primitives)
      .reduce((sum, p) => sum + p.completed, 0);
    const totalInvocations = stats.flatMap((s) => s.categories).flatMap((c) => c.primitives)
      .reduce((sum, p) => sum + p.invocations, 0);

    // Every real instance/invocation whose meta parses and whose primitive `st`
    // resolves to a prime-agent bucket is counted; root-edit and other
    // non-DR/IB `st` values are still valid instance kinds, so count generically
    // via the same meta fields the source reads instead of hardcoding a subset.
    const primeDocIds = new Set(primes.map((p) => p.id));
    let expectedActive = 0, expectedSuspended = 0, expectedCompleted = 0, expectedInvocations = 0;
    for (const inst of graph.instances) {
      if (!inst.m || !inst.st) continue;
      const meta = JSON.parse(inst.m) as { agent_doc_id?: string | null; status?: string | null };
      if (!meta.agent_doc_id || !primeDocIds.has(meta.agent_doc_id)) continue;
      if (meta.status === "Active") expectedActive++;
      else if (meta.status === "Suspended") expectedSuspended++;
      else if (meta.status === "Completed") expectedCompleted++;
    }
    for (const invo of graph.invocations) {
      if (!invo.m || !invo.st) continue;
      const meta = JSON.parse(invo.m) as { agent_doc_id?: string | null };
      if (!meta.agent_doc_id || !primeDocIds.has(meta.agent_doc_id)) continue;
      expectedInvocations++;
    }
    expect(totalActive).toBe(expectedActive);
    expect(totalSuspended).toBe(expectedSuspended);
    expect(totalCompleted).toBe(expectedCompleted);
    expect(totalInvocations).toBe(expectedInvocations);
  });

  it("primitive title strips a trailing ' Primitive' suffix from the doc title", () => {
    const withPrimitives = stats.find((s) => s.categories.some((c) => c.primitives.length > 0))!;
    for (const c of withPrimitives.categories) {
      for (const p of c.primitives) {
        expect(p.title.endsWith(" Primitive")).toBe(false);
        if (p.docId) expect(docs[p.docId].title).toBe(`${p.title} Primitive`);
      }
    }
  });
});

// Branches unreachable from the real atlas today: a primitive whose category
// doc doesn't resolve to a canonical name ("Unknown" + non-canonical append),
// an instance whose primitive was never itself seeded (statFor creates a new
// entry from scratch), a canonical category nobody has a primitive for (docId
// null fallback), and a prime agent with no operational executor.
describe("buildPrimitiveStats — synthetic: unknown category, unseeded primitive, no executor", () => {
  const currentPrimitivesDoc: AtlasNode = {
    id: CURRENT_PRIMITIVES_UUID, doc_no: "A.2.2.9.99", title: "Current Primitives", type: "Active Data",
    depth: 3, parentId: null, content: "- Cat A\n- Cat B\n", order: 0, addressRefs: [],
  };
  const agentDoc: AtlasNode = {
    id: "syn-agent-doc", doc_no: "Z.1", title: "Lonely Agent", type: "Core",
    depth: 3, parentId: null, content: "", order: 0, addressRefs: [],
  };
  const catADoc: AtlasNode = {
    id: "syn-catA-doc", doc_no: "Z.0.5.1", title: "Cat A", type: "Section",
    depth: 4, parentId: null, content: "", order: 0, addressRefs: [],
  };
  const widgetPrimDoc: AtlasNode = {
    id: "syn-widget-prim-doc", doc_no: "Z.1.2.9.1", title: "Widget Primitive", type: "Type Specification",
    depth: 5, parentId: null, content: "", order: 0, addressRefs: [],
  };
  const synDocs: Record<string, AtlasNode> = {
    [currentPrimitivesDoc.id]: currentPrimitivesDoc,
    [agentDoc.id]: agentDoc,
    [catADoc.id]: catADoc,
    [widgetPrimDoc.id]: widgetPrimDoc,
  };

  const agentEntity: GraphEntity = {
    id: "syn-agent-doc", slug: "lonely-agent", name: "Lonely Agent", et: "agent", st: "prime", did: "syn-agent-doc",
  };
  const widgetPrimitive: GraphEntity = {
    id: "syn-widget-prim", slug: "widget-primitive", name: "Widget Primitive", et: "primitive", st: "widget",
    did: "syn-widget-prim-doc",
    m: JSON.stringify({ agent_doc_id: "syn-agent-doc", primitive_category_doc_id: null, status: "Active" }),
  };
  // Seeded instance reuses the "widget" primitive slot.
  const widgetInstance: GraphEntity = {
    id: "syn-widget-inst", slug: "widget-inst", name: "Widget One", et: "instance", st: "widget", did: null,
    m: JSON.stringify({ agent_doc_id: "syn-agent-doc", primitive_category_doc_id: null, status: "Active" }),
  };
  // No matching primitive entity was ever seeded for "gadget" — statFor must
  // create the PrimitiveStat entry itself, falling back to icd.st for the title.
  const gadgetInstance: GraphEntity = {
    id: "syn-gadget-inst", slug: "gadget-inst", name: "Gadget One", et: "instance", st: "gadget", did: null,
    m: JSON.stringify({ agent_doc_id: "syn-agent-doc", primitive_category_doc_id: null, status: "Suspended" }),
  };
  const gadgetInvocation: GraphEntity = {
    id: "syn-gadget-invo", slug: "gadget-invo", name: "Gadget Two", et: "invocation", st: "gadget", did: null,
    m: JSON.stringify({ agent_doc_id: "syn-agent-doc", primitive_category_doc_id: null }),
  };
  // "implements" edge gives Cat A a docId even though no primitive/instance
  // ever references it — Cat B gets neither, so its docId stays null.
  const implementsEdge: RelationEdge = {
    f: "syn-widget-prim-doc", ft: "doc", t: "syn-catA-doc", tt: "entity", e: "implements",
  };

  const synGraph: GraphData = {
    participants: [agentEntity],
    instances: [widgetInstance, gadgetInstance],
    invocations: [gadgetInvocation],
    primitives: [widgetPrimitive],
    edges: [implementsEdge],
  };

  const stats = buildPrimitiveStats(synGraph, synDocs);
  const agentStat = stats.find((s) => s.slug === "lonely-agent")!;

  it("includes both canonical categories, Cat A carrying a docId via the implements edge, Cat B null", () => {
    const catA = agentStat.categories.find((c) => c.title === "Cat A")!;
    const catB = agentStat.categories.find((c) => c.title === "Cat B")!;
    expect(catA.docId).toBe("syn-catA-doc");
    expect(catA.primitives).toEqual([]);
    expect(catB.docId).toBeNull();
    expect(catB.primitives).toEqual([]);
  });

  it("appends a non-canonical 'Unknown' category for the null-category primitive/instances", () => {
    const unknown = agentStat.categories.find((c) => c.title === "Unknown")!;
    expect(unknown).toBeDefined();
    expect(unknown.docId).toBeNull();
    // Present after the two canonical categories (append, not interleaved).
    expect(agentStat.categories.indexOf(unknown)).toBe(2);
  });

  it("the seeded 'widget' primitive picks up its instance's Active count", () => {
    const unknown = agentStat.categories.find((c) => c.title === "Unknown")!;
    const widget = unknown.primitives.find((p) => p.st === "widget")!;
    expect(widget.title).toBe("Widget");
    expect(widget.active).toBe(1);
    expect(widget.activeNames).toEqual(["Widget One"]);
  });

  it("an unseeded 'gadget' primitive is created on the fly by statFor, titled from icd.st", () => {
    const unknown = agentStat.categories.find((c) => c.title === "Unknown")!;
    const gadget = unknown.primitives.find((p) => p.st === "gadget")!;
    expect(gadget.title).toBe("gadget");
    expect(gadget.docId).toBeNull();
    expect(gadget.suspended).toBe(1);
    expect(gadget.suspendedNames).toEqual(["Gadget One"]);
    expect(gadget.invocations).toBe(1);
    expect(gadget.invocationNames).toEqual(["Gadget Two"]);
  });

  it("executorName/executorSlug are null when no operational_executor_agent_for edge targets the agent", () => {
    expect(agentStat.executorName).toBeNull();
    expect(agentStat.executorSlug).toBeNull();
  });

  it("returns an empty category list gracefully when the Current Primitives doc is missing", () => {
    const { [CURRENT_PRIMITIVES_UUID]: _omit, ...docsWithoutCanonical } = synDocs;
    const noCanonicalStats = buildPrimitiveStats(synGraph, docsWithoutCanonical);
    const s = noCanonicalStats.find((x) => x.slug === "lonely-agent")!;
    // No canonical names at all, so every seeded category is appended as non-canonical.
    expect(s.categories.every((c) => c.title === "Unknown")).toBe(true);
  });
});
