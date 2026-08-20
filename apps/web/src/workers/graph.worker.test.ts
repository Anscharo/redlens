// Worker-side tests for src/workers/graph.worker.ts.
//
// Drives the real graph worker through its message protocol with a small
// hand-built relations.json: init/ready, edge resolution (with entity label
// enrichment), entity-by-slug, BFS neighbors/subgraph, the constellation
// query + agent-cluster responses, the pre-init null guards, and init failure.

import { describe, it, expect, afterEach, vi } from "vitest";
import { installWorkerGlobal, stubFetch, type WorkerHarness } from "../test/workerGlobal";
import { makeRelationsJson, G } from "../test/workerFixtures";
import type { ResolvedEdge, GraphEntity, SerializedSubgraph } from "@/types";

let harness: WorkerHarness | null = null;

afterEach(() => {
  harness?.restore();
  harness = null;
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function initGraphWorker(opts?: {
  name?: string;
  fail?: Record<string, number>;
  calls?: string[];
}): Promise<WorkerHarness> {
  const h = installWorkerGlobal(opts?.name ?? "");
  harness = h;
  stubFetch({ "relations.json": makeRelationsJson() }, { fail: opts?.fail, calls: opts?.calls });
  vi.resetModules();
  await import("./graph.worker.ts");
  await h.waitFor((m) => m.type === "ready");
  return h;
}

// Send a request and return the response it triggered — correlated by posting
// index so repeated same-type queries don't return a stale earlier response.
async function ask(h: WorkerHarness, msg: Record<string, unknown>, matchType: string) {
  const base = h.posted.length;
  h.dispatch(msg);
  return h.waitFor((m) => m.type === matchType, undefined, base);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe("init lifecycle", () => {
  it("posts ready with entities and only entity↔entity edges", async () => {
    const h = await initGraphWorker();
    const ready = h.ofType("ready")[0];
    expect((ready.entities as GraphEntity[]).length).toBe(7);
    // Of the 7 fixture edges, 5 are entity→entity; the entity→doc and doc→address are excluded.
    expect((ready.entityEdges as unknown[]).length).toBe(5);
  });

  it("threads a preview base through self.name", async () => {
    const calls: string[] = [];
    await initGraphWorker({ name: "/api/preview/xyz/", calls });
    expect(calls.some((u) => u === "/api/preview/xyz/relations.json")).toBe(true);
  });

  it("posts an error when relations.json fails to load", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({}, { fail: { "relations.json": 500 } });
    vi.resetModules();
    await import("./graph.worker.ts");
    const err = await h.waitFor((m) => m.type === "error");
    expect(String(err.message)).toContain("relations.json");
  });

  it("ping is answered with an (empty) ready", async () => {
    const h = await initGraphWorker();
    const before = h.ofType("ready").length;
    const pong = await ask(h, { type: "ping" }, "ready");
    expect(pong.entities).toEqual([]);
    expect(h.ofType("ready").length).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// Edge queries
// ---------------------------------------------------------------------------

describe("edges", () => {
  it("resolves outbound + inbound edges for an entity, enriching entity labels", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "edges", id: G.primeAgent }, "edges");
    const outbound = res.outbound as ResolvedEdge[];
    const inbound = res.inbound as ResolvedEdge[];

    // prime → composite (comprises) and prime → doc (defined_in) are outbound.
    expect(outbound.some((e) => e.e === "comprises" && e.t === G.composite)).toBe(true);
    // executor → prime and instance → prime are inbound.
    expect(inbound.some((e) => e.e === "operational_executor_agent_for" && e.f === G.execAgent)).toBe(true);
    expect(inbound.some((e) => e.e === "governed_by" && e.f === G.instance)).toBe(true);

    // Entity endpoints get from_label/to_label; the doc endpoint does not.
    const comprises = outbound.find((e) => e.e === "comprises")!;
    expect(comprises.from_label).toBe("Skybase");
    expect(comprises.to_label).toBe("Sky Foundation");
    const definedIn = outbound.find((e) => e.e === "defined_in")!;
    expect(definedIn.to_label).toBeUndefined(); // target is a doc, not an entity
  });

  it("passes edge meta (m) through when present", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "edges", id: G.instance }, "edges");
    const governed = (res.outbound as ResolvedEdge[]).find((e) => e.e === "governed_by");
    expect(governed?.m).toBe('{"status":"active"}');
  });

  it("returns empty arrays for an unknown node id", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "edges", id: "no-such-node" }, "edges");
    expect(res.outbound).toEqual([]);
    expect(res.inbound).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Entity by slug
// ---------------------------------------------------------------------------

describe("entity", () => {
  it("returns the entity and its combined (out+in) edges by slug", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "entity", slug: "skybase" }, "entity");
    expect((res.entity as GraphEntity).id).toBe(G.primeAgent);
    const edges = res.edges as ResolvedEdge[];
    // Both directions are flattened into one list.
    expect(edges.some((e) => e.f === G.primeAgent)).toBe(true);
    expect(edges.some((e) => e.t === G.primeAgent)).toBe(true);
  });

  it("returns null entity + no edges for an unknown slug", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "entity", slug: "ghost" }, "entity");
    expect(res.entity).toBeNull();
    expect(res.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Neighbors / subgraph (BFS)
// ---------------------------------------------------------------------------

describe("neighbors / subgraph", () => {
  it("neighbors defaults to depth 1 (outbound BFS) and includes only edges between included nodes", async () => {
    const h = await initGraphWorker();
    const res = (await ask(h, { type: "neighbors", id: G.primeAgent }, "neighbors")) as unknown as {
      nodes: SerializedSubgraph["nodes"];
      edges: SerializedSubgraph["edges"];
    };
    const ids = res.nodes.map((n) => n.id);
    // depth-1 out-edges from the prime agent: itself + composite (comprises) + doc (defined_in).
    expect(ids).toContain(G.primeAgent);
    expect(ids).toContain(G.composite);
    expect(ids).toContain(G.docId);
    // Every serialized edge connects two included nodes.
    for (const e of res.edges) {
      expect(ids).toContain(e.src);
      expect(ids).toContain(e.tgt);
    }
  });

  it("subgraph honours an explicit depth", async () => {
    const h = await initGraphWorker();
    const shallow = (await ask(h, { type: "subgraph", rootId: G.instance, depth: 1 }, "subgraph")) as unknown as {
      nodes: { id: string }[];
    };
    const deep = (await ask(h, { type: "subgraph", rootId: G.instance, depth: 3 }, "subgraph")) as unknown as {
      nodes: { id: string }[];
    };
    // instance → prime at depth 1; prime's neighbours (exec, composite, doc…) only at deeper depth.
    expect(deep.nodes.length).toBeGreaterThan(shallow.nodes.length);
    expect(shallow.nodes.map((n) => n.id)).toContain(G.primeAgent);
  });

  it("subgraph for an unknown root is empty", async () => {
    const h = await initGraphWorker();
    const res = (await ask(h, { type: "subgraph", rootId: "nope", depth: 2 }, "subgraph")) as unknown as {
      nodes: unknown[];
      edges: unknown[];
    };
    expect(res.nodes).toEqual([]);
    expect(res.edges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Constellation
// ---------------------------------------------------------------------------

describe("constellation", () => {
  it("query returns ranked matches with the best as topId", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "constellation-query", id: 1, q: "sky" }, "constellation-query");
    // 'Skybase' (len 7) ranks above 'Sky Foundation' (len 14) at equal prefix score.
    expect(res.topId).toBe(G.primeAgent);
    expect((res.neighborIds as string[])).toContain(G.composite);
  });

  it("empty query returns no matches", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "constellation-query", id: 2, q: "   " }, "constellation-query");
    expect(res.neighborIds).toEqual([]);
    expect(res.topId).toBeNull();
  });

  it("cluster for a prime agent pulls in role-linked executors, facilitators and govops", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "constellation-cluster", agentId: G.primeAgent }, "constellation-cluster");
    const ids = res.clusterIds as string[];
    expect(ids).toContain(G.primeAgent);
    expect(ids).toContain(G.execAgent);
    expect(ids).toContain(G.facilitator); // reached via operational_facilitator_for role edge
    expect(ids).toContain(G.govops);
  });

  it("cluster for a non-prime / unknown agent id is empty", async () => {
    const h = await initGraphWorker();
    const res = await ask(h, { type: "constellation-cluster", agentId: G.execAgent }, "constellation-cluster");
    expect(res.clusterIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pre-init null guards — messages that arrive before relations.json resolves
// ---------------------------------------------------------------------------

describe("pre-init guards", () => {
  // relations.json is held permanently pending so init() is guaranteed suspended
  // and `graph` is still null when the message is dispatched. This makes the
  // guard deterministic instead of racing init's microtask chain against import.
  it("neighbors before the graph loads returns an empty result", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({}, { pending: ["relations.json"] });
    vi.resetModules();
    await import("./graph.worker.ts");
    h.dispatch({ type: "neighbors", id: G.primeAgent, depth: 1 });
    const res = h.ofType("neighbors")[0];
    expect(res.nodes).toEqual([]);
    expect(res.edges).toEqual([]);
  });

  it("constellation-query before the graph loads returns empty", async () => {
    const h = installWorkerGlobal();
    harness = h;
    stubFetch({}, { pending: ["relations.json"] });
    vi.resetModules();
    await import("./graph.worker.ts");
    h.dispatch({ type: "constellation-query", id: 5, q: "sky" });
    const res = h.ofType("constellation-query")[0];
    expect(res.neighborIds).toEqual([]);
    expect(res.topId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defensive catch — a handler throwing must not crash the worker
// ---------------------------------------------------------------------------

describe("handler error fallback", () => {
  it("a throwing query is caught and answered with an empty fallback", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = installWorkerGlobal();
    harness = h;
    // An entity with a null name makes matchParticipants (e.name.toLowerCase()) throw.
    const relations = JSON.stringify({
      entities: [{ id: "bad", slug: "bad", name: null, et: "agent", st: "prime", did: null }],
      edges: [],
    });
    stubFetch({ "relations.json": relations });
    vi.resetModules();
    await import("./graph.worker.ts");
    await h.waitFor((m) => m.type === "ready");

    h.dispatch({ type: "constellation-query", id: 7, q: "anything" });
    // The handler is synchronous, so the catch block's fallback is already posted.
    const cq = h.ofType("constellation-query").at(-1)!;
    expect(cq.neighborIds).toEqual([]);
    expect(cq.topId).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
