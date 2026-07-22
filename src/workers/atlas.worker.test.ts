// Exercises the real atlas.worker.ts module (not a reimplementation) by
// stubbing `self` + `fetch`, importing the worker fresh per test, and
// inspecting the postMessage calls it makes. The worker has no message
// listener — all its logic runs as top-level side effects on import — so
// each test resets the module registry and re-imports to get a clean run.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AtlasNode } from "../types";

type PostedMessage = Record<string, unknown>;

function node(overrides: Partial<AtlasNode> & { id: string; doc_no: string; parentId: string | null }): AtlasNode {
  return {
    title: overrides.doc_no,
    type: "Core",
    depth: 1,
    content: "",
    order: 1,
    addressRefs: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function makeFetch(opts: {
  shallow?: { atlasCommit?: string; nodes: AtlasNode[] };
  deep?: { atlasCommit?: string; nodes: AtlasNode[] };
  shallowFail?: boolean;
  deepFail?: boolean;
}) {
  return vi.fn((url: string) => {
    const u = String(url);
    if (u.includes("docs-shallow.json")) {
      if (opts.shallowFail) return Promise.resolve(jsonResponse({}, false, 500));
      return Promise.resolve(jsonResponse(opts.shallow));
    }
    if (u.includes("docs-deep.json")) {
      if (opts.deepFail) return Promise.resolve(jsonResponse({}, false, 500));
      return Promise.resolve(jsonResponse(opts.deep));
    }
    throw new Error(`unexpected fetch url: ${u}`);
  });
}

function parentKeyFor(entries: [string | null, AtlasNode[]][], nodeId: string): string | null | undefined {
  for (const [key, nodes] of entries) {
    if (nodes.some((n) => n.id === nodeId)) return key;
  }
  return undefined;
}

let postMessage: ReturnType<typeof vi.fn>;

async function importWorker(fetchImpl: ReturnType<typeof makeFetch>) {
  vi.resetModules();
  postMessage = vi.fn();
  vi.stubGlobal("self", { postMessage, name: "" });
  vi.stubGlobal("fetch", fetchImpl);
  await import("./atlas.worker.ts");
}

function postedOfType(type: string): PostedMessage | undefined {
  return postMessage.mock.calls.map((c) => c[0] as PostedMessage).find((m) => m.type === type);
}

describe("atlas.worker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts shallow then ready, resolving parents via doc_no across the shallow/deep split", async () => {
    // "A.1.2" (midParent) only exists in the deep set, so nodes that depend on
    // it for parent resolution must fall back to node.parentId in the shallow
    // pass, then resolve correctly once ready merges shallow + deep.
    const midParent = node({ id: "mid-a12", doc_no: "A.1.2", parentId: "unused" });

    const nrNode = node({ id: "nr-id-1", doc_no: "NR-7", parentId: "some-parent-id" });
    const topScope = node({ id: "scope-a1", doc_no: "A.1", parentId: null });
    const varNode = node({ id: "var-node", doc_no: "A.1.2.var1", parentId: "fallback-parent-id" });
    const annotationNode = node({ id: "ann-node", doc_no: "A.1.2.0.3.1", parentId: "fallback-ann" });
    const actionTenetChild = node({ id: "at-node", doc_no: "A.1.2.0.4.5", parentId: "fallback-at" });
    const activeDataNode = node({ id: "ad-node", doc_no: "A.1.2.0.6.2", parentId: "fallback-ad" });
    // Nested scenario under an action tenet — resolves via candidateParent even
    // in the shallow-only pass, since its action-tenet parent is also shallow.
    const nestedScenarioTrue = node({ id: "scen-true", doc_no: "A.1.2.0.4.5.1.1", parentId: "fallback-scentrue" });
    // Scenario-shaped doc_no whose candidateParent exists but fails the
    // ".0.4.N" suffix regex (has=true, regex=false in the ready pass; has=false
    // in the shallow pass) — exercises both false-making sides of the AND.
    const scenMixed = node({ id: "scen-mixed", doc_no: "A.1.2.1.3", parentId: "fallback-scenmixed" });
    const defaultNode = node({ id: "default-node", doc_no: "A.1.2.5", parentId: "fallback-default" });
    const defaultNode2 = node({ id: "default-node-2", doc_no: "A.1.2.9", parentId: "fallback-default2" });

    const shallowNodes = [
      nrNode,
      topScope,
      varNode,
      annotationNode,
      actionTenetChild,
      activeDataNode,
      nestedScenarioTrue,
      scenMixed,
      defaultNode,
      defaultNode2,
    ];
    const deepNodes = [midParent];

    const fetchImpl = makeFetch({
      shallow: { atlasCommit: "sha-shallow", nodes: shallowNodes },
      deep: { atlasCommit: "sha-shallow", nodes: deepNodes },
    });
    await importWorker(fetchImpl);

    await vi.waitFor(() => expect(postedOfType("ready")).toBeDefined());

    const shallowMsg = postedOfType("shallow")!;
    expect(shallowMsg.atlasCommit).toBe("sha-shallow");
    const shallowEntries = shallowMsg.byParentEntries as [string | null, AtlasNode[]][];

    expect(parentKeyFor(shallowEntries, "nr-id-1")).toBe("some-parent-id");
    expect(parentKeyFor(shallowEntries, "scope-a1")).toBe(null);
    expect(parentKeyFor(shallowEntries, "var-node")).toBe("fallback-parent-id");
    expect(parentKeyFor(shallowEntries, "ann-node")).toBe("fallback-ann");
    expect(parentKeyFor(shallowEntries, "at-node")).toBe("fallback-at");
    expect(parentKeyFor(shallowEntries, "ad-node")).toBe("fallback-ad");
    expect(parentKeyFor(shallowEntries, "scen-true")).toBe("at-node");
    expect(parentKeyFor(shallowEntries, "scen-mixed")).toBe("fallback-scenmixed");
    expect(parentKeyFor(shallowEntries, "default-node")).toBe("fallback-default");
    expect(parentKeyFor(shallowEntries, "default-node-2")).toBe("fallback-default2");

    const readyMsg = postedOfType("ready")!;
    expect(readyMsg.atlasCommit).toBe("sha-shallow");
    expect(Object.keys(readyMsg.docs as Record<string, AtlasNode>)).toHaveLength(shallowNodes.length + deepNodes.length);
    const readyEntries = readyMsg.byParentEntries as [string | null, AtlasNode[]][];

    expect(parentKeyFor(readyEntries, "var-node")).toBe("mid-a12");
    expect(parentKeyFor(readyEntries, "ann-node")).toBe("mid-a12");
    expect(parentKeyFor(readyEntries, "at-node")).toBe("mid-a12");
    expect(parentKeyFor(readyEntries, "ad-node")).toBe("mid-a12");
    expect(parentKeyFor(readyEntries, "scen-true")).toBe("at-node");
    // has(candidateParent) now true, but regex on "A.1.2" still fails.
    expect(parentKeyFor(readyEntries, "scen-mixed")).toBe("fallback-scenmixed");
    expect(parentKeyFor(readyEntries, "default-node")).toBe("mid-a12");
    expect(parentKeyFor(readyEntries, "default-node-2")).toBe("mid-a12");
    // midParent's own doc_no ("A.1.2") happens to match the scenario-suffix
    // shape (parts[1] === "1"); its candidateParent "A" doesn't exist, so it
    // falls through to the plain default lookup and resolves via "A.1".
    expect(parentKeyFor(readyEntries, "mid-a12")).toBe("scope-a1");

    // Siblings under the same parent are sorted by `order`.
    const midBucket = readyEntries.find(([key]) => key === "mid-a12")![1];
    const orders = midBucket.map((n) => n.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));

    const docNoToId = new Map(readyMsg.docNoToIdEntries as [string, string][]);
    expect(docNoToId.get("A.1.2")).toBe("mid-a12");
  });

  it("posts an error when the deep fetch fails after a successful shallow fetch", async () => {
    const shallowNodes = [node({ id: "s1", doc_no: "A.1", parentId: null })];
    const fetchImpl = makeFetch({
      shallow: { nodes: shallowNodes },
      deepFail: true,
    });
    await importWorker(fetchImpl);

    await vi.waitFor(() => expect(postedOfType("error")).toBeDefined());
    expect(postedOfType("shallow")).toBeDefined();
    expect(postedOfType("ready")).toBeUndefined();
  });

  it("posts only an error (no shallow message) when the shallow fetch itself fails", async () => {
    const fetchImpl = makeFetch({
      shallowFail: true,
      deep: { nodes: [] },
    });
    await importWorker(fetchImpl);

    await vi.waitFor(() => expect(postedOfType("error")).toBeDefined());
    expect(postedOfType("shallow")).toBeUndefined();
    expect(postedOfType("ready")).toBeUndefined();
  });
});
