// Exercises the real graph.worker.ts module by stubbing `self` + `fetch`,
// importing it fresh per test, and driving its message handler directly
// (capturing the listener passed to self.addEventListener).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { GraphEntity, RelationEdge, GraphWorkerOutMessage } from "../types";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

const P1: GraphEntity = { id: "p1", slug: "prime-one", name: "Prime One", et: "agent", st: "prime", did: "doc-p1" };
const E1: GraphEntity = {
  id: "e1",
  slug: "executor-one",
  name: "Executor One",
  et: "agent",
  st: "operational_executor",
  did: "doc-e1",
};
const F1: GraphEntity = {
  id: "f1",
  slug: "facilitator-one",
  name: "Facilitator One",
  et: "facilitator_org",
  st: null,
  did: "doc-f1",
};
const ENTITIES = [P1, E1, F1];

const EDGES: RelationEdge[] = [
  { f: "p1", ft: "entity", t: "e1", tt: "entity", e: "comprises", s: ["A.1"] },
  { f: "e1", ft: "entity", t: "f1", tt: "entity", e: "operational_facilitator_for", s: ["A.2"] },
  { f: "e1", ft: "entity", t: "doc-x", tt: "doc", e: "annotates" },
  { f: "addr:ethereum:0xabc", ft: "address", t: "p1", tt: "entity", e: "has_address" },
];

let postMessage: ReturnType<typeof vi.fn>;
let messageHandler: ((e: { data: unknown }) => void) | undefined;

function makeFetch(ok = true) {
  return vi.fn((url: string) => {
    if (String(url).includes("relations.json")) {
      return ok
        ? Promise.resolve(jsonResponse({ entities: ENTITIES, edges: EDGES }))
        : Promise.resolve(jsonResponse({}, false, 500));
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
}

async function importWorker(fetchImpl: ReturnType<typeof makeFetch>) {
  vi.resetModules();
  postMessage = vi.fn();
  messageHandler = undefined;
  vi.stubGlobal("self", {
    postMessage,
    name: "",
    addEventListener: vi.fn((type: string, cb: (e: { data: unknown }) => void) => {
      if (type === "message") messageHandler = cb;
    }),
  });
  vi.stubGlobal("fetch", fetchImpl);
  await import("./graph.worker.ts");
}

function send(msg: unknown) {
  messageHandler!({ data: msg });
}

function lastPosted(): GraphWorkerOutMessage {
  return postMessage.mock.calls.at(-1)![0] as GraphWorkerOutMessage;
}

function postedOfType(type: string): GraphWorkerOutMessage | undefined {
  return postMessage.mock.calls.map((c) => c[0] as GraphWorkerOutMessage).find((m) => m.type === type);
}

describe("graph.worker", () => {
  afterEach(() => {
    vi.doUnmock("../lib/search");
    vi.unstubAllGlobals();
  });

  it("loads relations.json, builds entity-only edges, and answers ping regardless of init state", async () => {
    await importWorker(makeFetch());

    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());
    const ready = postedOfType("ready")! as { type: "ready"; entities: GraphEntity[]; entityEdges: RelationEdge[] };
    expect(ready.entities).toHaveLength(3);
    // Only entity->entity edges (not the doc or address edges) surface here.
    expect(ready.entityEdges.map((e) => e.e).sort()).toEqual(["comprises", "operational_facilitator_for"]);

    send({ type: "ping" });
    expect(lastPosted()).toEqual({ type: "ready", entities: [], entityEdges: [] });
  });

  it("resolves outbound/inbound edges with entity labels, and doc/address endpoints without them", async () => {
    await importWorker(makeFetch());
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    send({ type: "edges", id: "e1" });
    const e1Edges = lastPosted() as { type: "edges"; id: string; outbound: any[]; inbound: any[] };
    expect(e1Edges.outbound.map((e) => e.e).sort()).toEqual(["annotates", "operational_facilitator_for"]);
    expect(e1Edges.inbound.map((e) => e.e)).toEqual(["comprises"]);

    const toFacilitator = e1Edges.outbound.find((e) => e.e === "operational_facilitator_for")!;
    expect(toFacilitator.to_label).toBe("Facilitator One");
    expect(toFacilitator.to_did).toBe("doc-f1");
    expect(toFacilitator.from_label).toBe("Executor One");

    const toDoc = e1Edges.outbound.find((e) => e.e === "annotates")!;
    expect(toDoc.to_label).toBeUndefined();
    expect(toDoc.to_did).toBeUndefined();

    send({ type: "edges", id: "p1" });
    const p1Edges = lastPosted() as { type: "edges"; id: string; outbound: any[]; inbound: any[] };
    expect(p1Edges.inbound.map((e) => e.e)).toEqual(["has_address"]);
    expect(p1Edges.inbound[0].from_label).toBeUndefined();

    // Unknown node id — hits the !graph.hasNode(id) guard.
    send({ type: "edges", id: "does-not-exist" });
    expect(lastPosted()).toEqual({ type: "edges", id: "does-not-exist", outbound: [], inbound: [] });
  });

  it("resolves entity lookups by slug, found and not found", async () => {
    await importWorker(makeFetch());
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    send({ type: "entity", slug: "facilitator-one" });
    const found = lastPosted() as { type: "entity"; slug: string; entity: GraphEntity | null; edges: any[] };
    expect(found.entity).toEqual(F1);
    expect(found.edges.map((e: any) => e.e)).toEqual(["operational_facilitator_for"]);

    send({ type: "entity", slug: "nobody" });
    expect(lastPosted()).toEqual({ type: "entity", slug: "nobody", entity: null, edges: [] });
  });

  it("builds subgraphs for neighbors/subgraph messages, growing with depth", async () => {
    await importWorker(makeFetch());
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    // bfsFromNode follows outbound edges only, so the inbound address edge
    // into p1 is never reached regardless of depth.
    send({ type: "neighbors", id: "p1", depth: 1 });
    const depth1 = lastPosted() as { type: "neighbors"; id: string; nodes: any[]; edges: any[] };
    const depth1Ids = depth1.nodes.map((n) => n.id).sort();
    expect(depth1Ids).toEqual(["e1", "p1"]);

    send({ type: "neighbors", id: "p1", depth: 2 });
    const depth2 = lastPosted() as { type: "neighbors"; id: string; nodes: any[]; edges: any[] };
    const depth2Ids = depth2.nodes.map((n) => n.id).sort();
    expect(depth2Ids).toEqual(["doc-x", "e1", "f1", "p1"]);

    send({ type: "subgraph", rootId: "p1", depth: 1 });
    const sub = lastPosted() as { type: "subgraph"; rootId: string; nodes: any[]; edges: any[] };
    expect(sub.rootId).toBe("p1");
    expect(sub.nodes.map((n) => n.id).sort()).toEqual(depth1Ids);

    // Unknown root — hits the !graph.hasNode(rootId) guard in buildSubgraph.
    send({ type: "neighbors", id: "nope", depth: 1 });
    expect(lastPosted()).toEqual({ type: "neighbors", id: "nope", nodes: [], edges: [] });
  });

  it("answers constellation-query with score-ranked matches, and empty query short-circuits", async () => {
    await importWorker(makeFetch());
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    send({ type: "constellation-query", id: 1, q: "Facilitator" });
    const hit = lastPosted() as { type: "constellation-query"; id: number; neighborIds: string[]; topId: string | null };
    expect(hit.topId).toBe("f1");
    expect(hit.neighborIds).toContain("f1");

    send({ type: "constellation-query", id: 2, q: "   " });
    expect(lastPosted()).toEqual({ type: "constellation-query", id: 2, neighborIds: [], topId: null });
  });

  it("builds and looks up agent clusters, falling back to empty for unknown agents", async () => {
    await importWorker(makeFetch());
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    send({ type: "constellation-cluster", agentId: "p1" });
    const cluster = lastPosted() as { type: "constellation-cluster"; agentId: string; clusterIds: string[] };
    // p1 (prime) -> e1 (its executor neighbor) -> f1 (e1's facilitator via a
    // role edge in EXECUTOR_ROLE_EDGES).
    expect(cluster.clusterIds.sort()).toEqual(["e1", "f1", "p1"]);

    send({ type: "constellation-cluster", agentId: "unknown-agent" });
    expect(lastPosted()).toEqual({ type: "constellation-cluster", agentId: "unknown-agent", clusterIds: [] });
  });

  it("returns empty results for neighbors/constellation-query sent before init resolves", async () => {
    let resolveFetch!: (v: unknown) => void;
    const pendingFetch = vi.fn(() => new Promise((res) => { resolveFetch = res; }));
    vi.resetModules();
    postMessage = vi.fn();
    messageHandler = undefined;
    vi.stubGlobal("self", {
      postMessage,
      name: "",
      addEventListener: vi.fn((type: string, cb: (e: { data: unknown }) => void) => {
        if (type === "message") messageHandler = cb;
      }),
    });
    vi.stubGlobal("fetch", pendingFetch);
    await import("./graph.worker.ts");

    send({ type: "neighbors", id: "p1", depth: 1 });
    expect(lastPosted()).toEqual({ type: "neighbors", id: "p1", nodes: [], edges: [] });

    send({ type: "constellation-query", id: 5, q: "prime" });
    expect(lastPosted()).toEqual({ type: "constellation-query", id: 5, neighborIds: [], topId: null });

    resolveFetch(jsonResponse({ entities: ENTITIES, edges: EDGES }));
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());
  });

  it("falls back to safe defaults and logs when a handler throws mid-message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("../lib/search", () => ({
      matchParticipants: () => {
        throw new Error("boom");
      },
    }));
    postMessage = vi.fn();
    messageHandler = undefined;
    vi.stubGlobal("self", {
      postMessage,
      name: "",
      addEventListener: vi.fn((type: string, cb: (e: { data: unknown }) => void) => {
        if (type === "message") messageHandler = cb;
      }),
    });
    vi.stubGlobal("fetch", makeFetch());
    await import("./graph.worker.ts");
    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    send({ type: "constellation-query", id: 9, q: "prime" });
    expect(lastPosted()).toEqual({ type: "constellation-query", id: 9, neighborIds: [], topId: null });
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("posts an error message when the relations fetch fails", async () => {
    await importWorker(makeFetch(false));
    await vi.waitFor(() => expect(postedOfType("error")).toBeDefined());
  });
});
