// Worker-lifecycle recovery for the graph client (deep review Exec #4): a worker
// init failure must SETTLE every waiter with an error instead of hanging forever,
// and the next consumer call must respawn a fresh worker. Driven with a mock
// Worker so we can inject "error"/"ready" without a real relations.json fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./analytics", () => ({ captureException: () => {} }));

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
});

afterEach(() => {
  (globalThis as { Worker: unknown }).Worker = realWorker as unknown;
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

  it("treats a worker-script load error (no message) as an init failure", async () => {
    const g = await import("./graph");

    const p = g.getConstellationInit();
    MockWorker.instances[0].emit("error", { message: "Failed to load worker script" });

    await expect(p).rejects.toThrow(/load worker/);
  });
});
