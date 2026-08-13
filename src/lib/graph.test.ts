// Worker-lifecycle recovery for the graph client (deep review Exec #4): a worker
// init failure must SETTLE every waiter with an error instead of hanging forever,
// and the next consumer call must respawn a fresh worker. Driven with a mock
// Worker so we can inject "error"/"ready" without a real relations.json fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./analytics", () => ({ captureException: () => {} }));

const fetchJsonMock = vi.fn();
vi.mock("./verify", () => ({
  fetchJson: (url: string, name: string) => fetchJsonMock(url, name),
  StaleAtlasError: class StaleAtlasError extends Error {
    constructor(url: string) {
      super(`StaleAtlasError: ${url}`);
      this.name = "StaleAtlasError";
    }
  },
}));

type Listener = (e: unknown) => void;

class MockWorker {
  static instances: MockWorker[] = [];
  listeners: Record<string, Listener[]> = {};
  terminated = false;
  posted: unknown[] = [];
  constructor(public url: URL, public opts: unknown) {
    MockWorker.instances.push(this);
  }
  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(data);
  }
}

const realWorker = globalThis.Worker;

beforeEach(() => {
  MockWorker.instances = [];
  (globalThis as { Worker: unknown }).Worker = MockWorker as unknown;
  vi.resetModules(); // fresh module-level worker/ready state per test
  fetchJsonMock.mockReset();
});

afterEach(() => {
  (globalThis as { Worker: unknown }).Worker = realWorker as unknown;
  vi.useRealTimers();
});

describe("graph worker init failure recovery", () => {
  it("rejects getConstellationInit waiters on an init error and respawns on the next call", async () => {
    const g = await import("./graph");

    const p = g.getConstellationInit();
    const w0 = MockWorker.instances[0];
    expect(w0).toBeDefined();
    w0.emit("message", { data: { type: "error", message: "relations.json 500" } });

    await expect(p).rejects.toThrow(/500/);
    expect(w0.terminated).toBe(true);

    // Next call respawns a fresh worker (index 1), and a ready message resolves it.
    const p2 = g.getConstellationInit();
    expect(MockWorker.instances.length).toBe(2);
    const w1 = MockWorker.instances[1];
    w1.emit("message", { data: { type: "ready", entities: [], entityEdges: [] } });
    await expect(p2).resolves.toEqual({ entities: [], entityEdges: [] });
  });

  it("rejects getEdges (awaiting whenReady) on an init error instead of hanging", async () => {
    const g = await import("./graph");

    const p = g.getEdges("node-1");
    MockWorker.instances[0].emit("message", { data: { type: "error", message: "boom" } });

    await expect(p).rejects.toThrow(/boom/);
  });

  it("uses the stable worker-script error message when the event has detail", async () => {
    const g = await import("./graph");

    const p = g.getConstellationInit();
    MockWorker.instances[0].emit("error", { message: "Failed to load worker script" });

    await expect(p).rejects.toThrow(/^graph worker script failed to load$/);
  });

  // The real-world shape (PostHog issue 019fa971): an opaque worker-script load
  // event with NO message. The synthesized message must be a stable non-empty
  // constant — error tracking fingerprints on it, so it has to group, and it has
  // to say something. Variable context (atlas base, script url) goes in extras.
  it("synthesizes a stable message for an opaque (message-less) worker error", async () => {
    const g = await import("./graph");

    const p = g.getEdges("node-1");
    MockWorker.instances[0].emit("error", { message: "" });

    await expect(p).rejects.toThrow(/^graph worker script failed to load$/);
  });
});

describe("loadGraph", () => {
  function entity(id: string, et: string) {
    return { id, et, name: id, slug: id } as unknown as import("../types").GraphEntity;
  }

  it("partitions entities into participants/instances/invocations/primitives and passes edges through", async () => {
    const g = await import("./graph");
    fetchJsonMock.mockResolvedValueOnce({
      entities: [entity("p1", "agent"), entity("i1", "instance"), entity("inv1", "invocation"), entity("prim1", "primitive")],
      edges: [{ e: "test", f: "p1", t: "i1", ft: "entity", tt: "entity" }],
    });

    const data = await g.loadGraph("/base/");

    expect(data.participants.map((e) => e.id)).toEqual(["p1"]);
    expect(data.instances.map((e) => e.id)).toEqual(["i1"]);
    expect(data.invocations.map((e) => e.id)).toEqual(["inv1"]);
    expect(data.primitives.map((e) => e.id)).toEqual(["prim1"]);
    expect(data.edges).toHaveLength(1);
    expect(fetchJsonMock).toHaveBeenCalledWith("/base/relations.json", "relations.json");
  });

  it("caches the promise per base — a second call with the same base doesn't refetch", async () => {
    const g = await import("./graph");
    fetchJsonMock.mockResolvedValueOnce({ entities: [], edges: [] });

    const p1 = g.loadGraph("/base/");
    const p2 = g.loadGraph("/base/");
    expect(p1).toBe(p2);
    await p1;
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it("fetches independently per distinct base", async () => {
    const g = await import("./graph");
    fetchJsonMock.mockResolvedValue({ entities: [], edges: [] });

    await g.loadGraph("/base-a/");
    await g.loadGraph("/base-b/");
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("propagates a non-stale fetch error and evicts the cache so a retry refetches", async () => {
    const g = await import("./graph");
    fetchJsonMock.mockRejectedValueOnce(new Error("relations.json: 500"));

    await expect(g.loadGraph("/base/")).rejects.toThrow(/500/);

    fetchJsonMock.mockResolvedValueOnce({ entities: [], edges: [] });
    await expect(g.loadGraph("/base/")).resolves.toEqual({
      participants: [],
      instances: [],
      invocations: [],
      primitives: [],
      edges: [],
    });
    expect(fetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("never resolves/rejects on a StaleAtlasError (force-forward path)", async () => {
    const g = await import("./graph");
    const verify = await import("./verify");
    fetchJsonMock.mockRejectedValueOnce(new verify.StaleAtlasError("/base/relations.json"));

    let settled = false;
    g.loadGraph("/base/").then(
      () => (settled = true),
      () => (settled = true),
    );
    // Flush several microtask turns — the promise must still be pending.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("edges / constellationQuery / constellationCluster (success paths)", () => {
  async function readyGraph() {
    const g = await import("./graph");
    const p = g.getConstellationInit();
    MockWorker.instances[0].emit("message", { data: { type: "ready", entities: [], entityEdges: [] } });
    await p;
    return { g, w: MockWorker.instances[0] };
  }

  it("getEdges posts an 'edges' request and resolves with the worker's outbound/inbound payload", async () => {
    const { g, w } = await readyGraph();
    const p = g.getEdges("node-1");
    await Promise.resolve(); // let the internal `await whenReady()` settle before postMessage
    expect(w.posted).toEqual([{ type: "edges", id: "node-1" }]);
    w.emit("message", { data: { type: "edges", id: "node-1", outbound: [{ e: "x" }], inbound: [] } });
    await expect(p).resolves.toEqual({ outbound: [{ e: "x" }], inbound: [] });
  });

  it("constellationQuery posts a query and resolves with neighborIds/topId", async () => {
    const { g, w } = await readyGraph();
    const p = g.constellationQuery(7, "spark");
    await Promise.resolve();
    expect(w.posted).toEqual([{ type: "constellation-query", id: 7, q: "spark" }]);
    w.emit("message", { data: { type: "constellation-query", id: 7, neighborIds: ["a", "b"], topId: "a" } });
    await expect(p).resolves.toEqual({ neighborIds: ["a", "b"], topId: "a" });
  });

  it("constellationCluster posts an agent id and resolves with clusterIds", async () => {
    const { g, w } = await readyGraph();
    const p = g.constellationCluster("agent-1");
    await Promise.resolve();
    expect(w.posted).toEqual([{ type: "constellation-cluster", agentId: "agent-1" }]);
    w.emit("message", { data: { type: "constellation-cluster", agentId: "agent-1", clusterIds: ["x", "y"] } });
    await expect(p).resolves.toEqual(["x", "y"]);
  });

  it("ignores a message for an id with no pending callback (already resolved/timed out)", async () => {
    const { w } = await readyGraph();
    // No throw — the handler just no-ops when edgePending has no entry for this id.
    expect(() => w.emit("message", { data: { type: "edges", id: "unknown", outbound: [], inbound: [] } })).not.toThrow();
  });

  it("rejects a pending request that times out with no response", async () => {
    vi.useFakeTimers();
    const g = await import("./graph");
    const p = g.getConstellationInit();
    MockWorker.instances[0].emit("message", { data: { type: "ready", entities: [], entityEdges: [] } });
    await p;

    const edgesPromise = g.getEdges("slow-node");
    const assertion = expect(edgesPromise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });
});
