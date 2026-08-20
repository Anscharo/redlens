// Worker-side tests for src/workers/atlas.worker.ts.
//
// The atlas worker owns two artifacts split by depth (docs-shallow.json,
// docs-deep.json) and posts twice: a `shallow` message the instant the shallow
// set lands (first paint), then a `ready` with the merged tree. It also rebuilds
// the parent/doc_no lookup maps, resolving the Atlas' structural doc-number
// suffixes (var, .0.3/.4/.6 supporting docs, NR-*). These tests drive that flow
// and assert the parent resolution against a fixture that exercises each rule.

import { describe, it, expect, afterEach, vi } from "vitest";
import { installWorkerGlobal, stubFetch, type WorkerHarness } from "../test/workerGlobal";
import type { AtlasNode } from "@/types";

let harness: WorkerHarness | null = null;

afterEach(() => {
  harness?.restore();
  harness = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

function node(overrides: Partial<AtlasNode> & { id: string; doc_no: string }): AtlasNode {
  return {
    title: overrides.title ?? overrides.doc_no,
    type: "Core",
    depth: overrides.doc_no.split(".").length,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
    ...overrides,
  };
}

// A tree covering every parent-resolution branch in buildMaps:
//   scope (A.1) → core (A.1.2) → { scenario (A.1.2.1), annotation (A.1.2.0.3.1),
//   active-data (A.1.2.0.6.1), action-tenet (A.1.2.0.4.1) → scenario child
//   (A.1.2.0.4.1.1) }, and a scenario variation (A.1.2.1.var1) under the scenario.
//   Plus a top-level Needed Research node (NR-3) that keeps its explicit parentId.
const SHALLOW: AtlasNode[] = [
  node({ id: "id-scope", doc_no: "A.1" }),
  node({ id: "id-core", doc_no: "A.1.2", parentId: "id-scope" }),
  node({ id: "id-annotation", doc_no: "A.1.2.0.3.1", parentId: "wrong-cap" }),
  node({ id: "id-activedata", doc_no: "A.1.2.0.6.1", parentId: "wrong-cap" }),
  node({ id: "id-tenet", doc_no: "A.1.2.0.4.1", parentId: "wrong-cap" }),
  node({ id: "id-scenario", doc_no: "A.1.2.1", parentId: "wrong-cap" }),
];
const DEEP: AtlasNode[] = [
  node({ id: "id-var", doc_no: "A.1.2.1.var1", parentId: "wrong-cap" }),
  // A scenario numbered under an action tenet: doc_no ends ".1.N" AND its
  // slice-2 ancestor is the ".0.4.N" tenet — the dedicated tenet-scenario branch.
  node({ id: "id-tenet-scenario", doc_no: "A.1.2.0.4.1.1.1", parentId: "wrong-cap" }),
  node({ id: "id-nr", doc_no: "NR-3", parentId: "id-scope" }),
];

const SHALLOW_JSON = { atlasCommit: "deadbeef", nodes: SHALLOW };
const DEEP_JSON = { atlasCommit: "deadbeef", nodes: DEEP };

async function initAtlasWorker(opts?: {
  name?: string;
  fail?: Record<string, number>;
  calls?: string[];
  shallow?: unknown;
  deep?: unknown;
}): Promise<WorkerHarness> {
  const h = installWorkerGlobal(opts?.name ?? "");
  harness = h;
  stubFetch(
    {
      "docs-shallow.json": opts?.shallow ?? SHALLOW_JSON,
      "docs-deep.json": opts?.deep ?? DEEP_JSON,
    },
    { fail: opts?.fail, calls: opts?.calls },
  );
  vi.resetModules();
  await import("./atlas.worker.ts");
  return h;
}

// byParent lookup keyed by parent id, from the byParentEntries a message carries.
function byParentMap(msg: Record<string, unknown>): Map<string | null, AtlasNode[]> {
  return new Map(msg.byParentEntries as [string | null, AtlasNode[]][]);
}
function childrenOf(msg: Record<string, unknown>, parentId: string | null): string[] {
  return (byParentMap(msg).get(parentId) ?? []).map((n) => n.id);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("init lifecycle", () => {
  it("posts shallow first, then ready with the merged tree", async () => {
    const h = await initAtlasWorker();
    const shallow = await h.waitFor((m) => m.type === "shallow");
    const ready = await h.waitFor((m) => m.type === "ready");

    expect(Object.keys(shallow.docs as object)).toHaveLength(SHALLOW.length);
    expect(Object.keys(ready.docs as object)).toHaveLength(SHALLOW.length + DEEP.length);
    // shallow is posted before ready.
    expect(h.posted.findIndex((m) => m.type === "shallow")).toBeLessThan(
      h.posted.findIndex((m) => m.type === "ready"),
    );
  });

  it("forwards the atlasCommit on both messages", async () => {
    const h = await initAtlasWorker();
    const shallow = await h.waitFor((m) => m.type === "shallow");
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(shallow.atlasCommit).toBe("deadbeef");
    expect(ready.atlasCommit).toBe("deadbeef");
  });

  it("defaults atlasCommit to null when the artifact omits it", async () => {
    const h = await initAtlasWorker({
      shallow: { nodes: SHALLOW },
      deep: { nodes: DEEP },
    });
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(ready.atlasCommit).toBeNull();
  });

  it("threads a preview base through self.name", async () => {
    const calls: string[] = [];
    await initAtlasWorker({ name: "/api/preview/p1/", calls });
    expect(calls.some((u) => u === "/api/preview/p1/docs-shallow.json")).toBe(true);
    expect(calls.some((u) => u === "/api/preview/p1/docs-deep.json")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("posts a single error when the deep artifact fails (no shallow-path duplicate)", async () => {
    const h = await initAtlasWorker({ fail: { "docs-deep.json": 404 } });
    // shallow still succeeds and paints.
    await h.waitFor((m) => m.type === "shallow");
    const err = await h.waitFor((m) => m.type === "error");
    expect(String(err.message)).toContain("docs-deep.json");
    expect(h.ofType("error")).toHaveLength(1);
  });

  it("posts an error and no shallow when the shallow artifact fails", async () => {
    const h = await initAtlasWorker({ fail: { "docs-shallow.json": 500 } });
    const err = await h.waitFor((m) => m.type === "error");
    expect(String(err.message)).toContain("docs-shallow.json");
    expect(h.ofType("shallow")).toHaveLength(0);
    expect(h.ofType("error")).toHaveLength(1);
  });

  // P2 fix: a shallow rejection now also posts its own dedicated message
  // instead of being silently swallowed — this is what lets docs.ts spawn()
  // settle its `shallow` promise when a shallow failure arrives too late to
  // be the reason named in Promise.all's single "error" (the both-failed,
  // deep-rejects-first race — see docs.test.ts "settles shallow (rejects,
  // not hangs) when BOTH artifacts fail and deep rejects first").
  it("posts a dedicated shallow-error whenever the shallow artifact fails, alongside the blanket error", async () => {
    const h = await initAtlasWorker({ fail: { "docs-shallow.json": 500 } });
    const shallowErr = await h.waitFor((m) => m.type === "shallow-error");
    expect(String(shallowErr.message)).toContain("docs-shallow.json");
    expect(h.ofType("shallow-error")).toHaveLength(1);
    await h.waitFor((m) => m.type === "error");
    expect(h.ofType("error")).toHaveLength(1);
  });

  it("posts both a shallow-error and the blanket error when both artifacts fail", async () => {
    const h = await initAtlasWorker({ fail: { "docs-shallow.json": 500, "docs-deep.json": 404 } });
    await h.waitFor((m) => m.type === "shallow-error");
    await h.waitFor((m) => m.type === "error");
    expect(h.ofType("shallow")).toHaveLength(0);
    expect(h.ofType("ready")).toHaveLength(0);
    expect(h.ofType("shallow-error")).toHaveLength(1);
    expect(h.ofType("error")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Parent/doc_no resolution (buildMaps) — the load-bearing structural rules
// ---------------------------------------------------------------------------

describe("parent resolution", () => {
  it("two-segment scope nodes have no parent (root bucket)", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(childrenOf(ready, null)).toContain("id-scope");
  });

  it("a plain child resolves to its doc_no-prefix parent", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(childrenOf(ready, "id-scope")).toContain("id-core");
  });

  it("supporting docs (.0.3 annotation, .0.4 tenet, .0.6 active-data) attach to the base doc, not the .0.X path", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    const coreChildren = childrenOf(ready, "id-core");
    expect(coreChildren).toContain("id-annotation");
    expect(coreChildren).toContain("id-tenet");
    expect(coreChildren).toContain("id-activedata");
  });

  it("a scenario (.1.X) attaches to the base doc", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(childrenOf(ready, "id-core")).toContain("id-scenario");
  });

  it("a scenario variation (.varX) attaches to its scenario", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(childrenOf(ready, "id-scenario")).toContain("id-var");
  });

  it("a scenario under an action tenet (.0.4.N.M) attaches to the tenet", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(childrenOf(ready, "id-tenet")).toContain("id-tenet-scenario");
  });

  it("Needed Research (NR-*) keeps its explicit parentId", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    // NR-3 was given parentId id-scope and must not be re-parented by doc_no rules.
    expect(childrenOf(ready, "id-scope")).toContain("id-nr");
  });

  it("children within a bucket are sorted by order", async () => {
    const h = await initAtlasWorker({
      shallow: {
        nodes: [
          node({ id: "p", doc_no: "A.2" }),
          node({ id: "c-late", doc_no: "A.2.1", parentId: "p", order: 5 }),
          node({ id: "c-early", doc_no: "A.2.2", parentId: "p", order: 1 }),
        ],
      },
      deep: { nodes: [] },
    });
    const ready = await h.waitFor((m) => m.type === "ready");
    expect(childrenOf(ready, "p")).toEqual(["c-early", "c-late"]);
  });

  it("the shallow message already carries usable parent maps for first paint", async () => {
    const h = await initAtlasWorker();
    const shallow = await h.waitFor((m) => m.type === "shallow");
    // Shallow-only: core's supporting docs are present and correctly parented
    // before the deep set arrives.
    expect(childrenOf(shallow, "id-core")).toContain("id-annotation");
    expect(childrenOf(shallow, "id-scope")).toContain("id-core");
  });

  it("exposes docNoToId entries for doc-number navigation", async () => {
    const h = await initAtlasWorker();
    const ready = await h.waitFor((m) => m.type === "ready");
    const map = new Map(ready.docNoToIdEntries as [string, string][]);
    expect(map.get("A.1")).toBe("id-scope");
    expect(map.get("A.1.2.1.var1")).toBe("id-var");
  });
});
