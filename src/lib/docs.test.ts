// resolveAtlasRef must be scoped per data-source base (deep review finding):
// registerRefs is fed by every resolved bundle, including preview bundles —
// an unkeyed global index would let a preview's doc_no collide with (and
// resolve to) a live-atlas node id once both had loaded in the same session.
// Driven with a mock Worker so no real docs.json fetch is needed.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AtlasNode } from "../types";

type Listener = (e: unknown) => void;

class MockWorker {
  static instances: MockWorker[] = [];
  listeners: Record<string, Listener[]> = {};
  terminated = false;
  constructor(public url: URL, public opts: { name?: string }) {
    MockWorker.instances.push(this);
  }
  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  terminate() {
    this.terminated = true;
  }
  emit(type: string, data: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(data);
  }
}

const realWorker = globalThis.Worker;

function node(id: string, docNo: string): AtlasNode {
  return {
    id,
    doc_no: docNo,
    title: "t",
    type: "Core",
    depth: 1,
    parentId: null,
    order: 0,
    content: "",
    addressRefs: [],
  } as unknown as AtlasNode;
}

function readyMsg(id: string, docNo: string) {
  return {
    type: "ready",
    docs: { [id]: node(id, docNo) },
    atlasCommit: null,
    byParentEntries: [],
    docNoToIdEntries: [[docNo, id]],
  };
}

function shallowMsg(id: string, docNo: string) {
  return {
    type: "shallow",
    docs: { [id]: node(id, docNo) },
    atlasCommit: null,
    byParentEntries: [],
    docNoToIdEntries: [[docNo, id]],
  };
}

function errorMsg(message: string) {
  return { type: "error", message };
}

function shallowErrorMsg(message: string) {
  return { type: "shallow-error", message };
}

beforeEach(() => {
  MockWorker.instances = [];
  (globalThis as { Worker: unknown }).Worker = MockWorker as unknown;
});

afterEach(() => {
  (globalThis as { Worker: unknown }).Worker = realWorker as unknown;
});

describe("resolveAtlasRef base scoping", () => {
  it("does not resolve a doc_no registered under a different base", async () => {
    const docs = await import("./docs");

    const liveId = "11111111-1111-1111-1111-111111111111";
    const previewId = "22222222-2222-2222-2222-222222222222";
    const DOC_NO = "A.1.2"; // same doc_no, different node id per base

    docs.loadAtlas("/live/");
    MockWorker.instances[0].emit("message", { data: readyMsg(liveId, DOC_NO) });
    await docs.loadAtlas("/live/");

    docs.loadAtlas("/preview/abc/");
    MockWorker.instances[1].emit("message", { data: readyMsg(previewId, DOC_NO) });
    await docs.loadAtlas("/preview/abc/");

    // Each base's doc_no resolves to ITS OWN node id, never the other base's.
    expect(docs.resolveAtlasRef("/live/", DOC_NO)).toBe(liveId);
    expect(docs.resolveAtlasRef("/preview/abc/", DOC_NO)).toBe(previewId);
  });

  it("returns undefined for a base that has never resolved a bundle", async () => {
    const docs = await import("./docs");
    expect(docs.resolveAtlasRef("/never-loaded/", "A.9.9")).toBeUndefined();
  });
});

// R3: the worker posts one blanket "error" for Promise.all([shallowP, deepP])
// even when only docs-deep.json failed, and used to reject BOTH `shallow` and
// `full` unconditionally — destroying an already-loaded (or still in-flight)
// shallow tree over a deep-only failure. spawn() now reads the artifact name
// fetchJson embeds in the error message to tell a deep-only failure apart from
// one that also/only implicates shallow.
describe("spawn() shallow/deep decoupling (R3)", () => {
  it("a deep-only failure rejects full but leaves the worker running for shallow's own fetch", async () => {
    const docs = await import("./docs");
    const base = "/r3-deep-only/";
    const id = "44444444-4444-4444-4444-444444444444";

    const shallowPromise = docs.loadAtlasShallow(base);
    const fullPromise = docs.loadAtlas(base);
    const worker = MockWorker.instances[0];

    // Deep fails FIRST — the exact race this protects against: Promise.all
    // rejects the instant deepP rejects, without waiting for shallowP.
    worker.emit("message", { data: errorMsg("Error: docs-deep.json: 404") });
    await expect(fullPromise).rejects.toThrow();
    // Not terminated: shallow hasn't settled yet, so its independent fetch
    // (atlas.worker.ts's own shallowP.then/.catch) is still worth waiting on.
    expect(worker.terminated).toBe(false);

    // Shallow's own fetch lands afterward and still resolves normally.
    worker.emit("message", { data: shallowMsg(id, "A.9") });
    const shallow = await shallowPromise;
    expect(shallow.docs[id]).toBeDefined();
  });

  // P2 (reviewer-flagged): when BOTH artifacts fail and docs-deep.json's
  // rejection wins the Promise.all race (same setup as the test above), the
  // "error" branch looks deep-only and leaves `shallow` pending on the
  // worker's still-in-flight shallow fetch — correctly so, since at that
  // point shallow might still succeed. But if shallow ALSO fails, nothing
  // used to tell spawn(): atlas.worker.ts swallowed that second rejection
  // with no message, so `shallow` hung forever — useAtlasData got a
  // deepError but no shallowError, and with `data` still null, AtlasView sat
  // on an eternal loading screen with no retry control. atlas.worker.ts now
  // posts a dedicated "shallow-error" message for this; assert it actually
  // settles (rejects) `shallow` instead of hanging.
  it("settles shallow (rejects, not hangs) when BOTH artifacts fail and deep rejects first", async () => {
    const docs = await import("./docs");
    const base = "/r3-both-fail-deep-first/";

    const shallowPromise = docs.loadAtlasShallow(base);
    const fullPromise = docs.loadAtlas(base);
    const worker = MockWorker.instances[0];

    // Deep rejects first, exactly like the deep-only race above: `full`
    // rejects and the worker is left running, `shallow` still pending.
    worker.emit("message", { data: errorMsg("Error: docs-deep.json: 404") });
    await expect(fullPromise).rejects.toThrow();
    expect(worker.terminated).toBe(false);

    // Shallow's own fetch settles too — with a failure this time. The
    // dedicated "shallow-error" message (not a second "error") is what must
    // settle `shallow`.
    worker.emit("message", { data: shallowErrorMsg("Error: docs-shallow.json: 500") });
    await expect(shallowPromise).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("a deep-only failure arriving AFTER shallow already resolved leaves shallow resolved and cleans up the worker", async () => {
    const docs = await import("./docs");
    const base = "/r3-deep-only-late/";
    const id = "55555555-5555-5555-5555-555555555555";

    const shallowPromise = docs.loadAtlasShallow(base);
    const fullPromise = docs.loadAtlas(base);
    const worker = MockWorker.instances[0];

    worker.emit("message", { data: shallowMsg(id, "A.8") });
    await expect(shallowPromise).resolves.toMatchObject({ docs: { [id]: { doc_no: "A.8" } } });

    worker.emit("message", { data: errorMsg("Error: docs-deep.json: 404") });
    await expect(fullPromise).rejects.toThrow();
    // Nothing left to wait for once shallow already settled — safe to clean up.
    expect(worker.terminated).toBe(true);
  });

  it("rejects both shallow and full when the message doesn't name deep specifically (network-level failure)", async () => {
    const docs = await import("./docs");
    const base = "/r3-ambiguous/";

    const shallowPromise = docs.loadAtlasShallow(base);
    const fullPromise = docs.loadAtlas(base);
    const worker = MockWorker.instances[0];

    worker.emit("message", { data: errorMsg("TypeError: Failed to fetch") });
    await expect(fullPromise).rejects.toThrow();
    await expect(shallowPromise).rejects.toThrow();
    expect(worker.terminated).toBe(true);
  });

  it("rejects both shallow and full when the message names shallow", async () => {
    const docs = await import("./docs");
    const base = "/r3-shallow-fail/";

    const shallowPromise = docs.loadAtlasShallow(base);
    const fullPromise = docs.loadAtlas(base);
    const worker = MockWorker.instances[0];

    worker.emit("message", { data: errorMsg("Error: docs-shallow.json: 500") });
    await expect(fullPromise).rejects.toThrow();
    await expect(shallowPromise).rejects.toThrow();
  });

  it("a stale-atlas error still terminates the worker without settling either promise", async () => {
    const docs = await import("./docs");
    const base = "/r3-stale/";

    docs.loadAtlasShallow(base);
    docs.loadAtlas(base);
    const worker = MockWorker.instances[0];

    // Unchanged behavior (handledStaleMessage short-circuits before the
    // deepOnly logic) — just confirms the reordered terminate() call still
    // fires for this branch. typeof window === "undefined" in this file's
    // (non-jsdom) test environment, so reloadOnce() no-ops rather than
    // actually navigating.
    worker.emit("message", { data: errorMsg("StaleAtlasError: /r3-stale/docs-deep.json") });
    expect(worker.terminated).toBe(true);
  });
});
