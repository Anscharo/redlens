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
  constructor(public url: URL, public opts: { name?: string }) {
    MockWorker.instances.push(this);
  }
  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  terminate() {}
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
