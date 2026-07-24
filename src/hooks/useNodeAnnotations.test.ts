// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { AtlasNode, AddressInfo } from "../types";
import type { Glossary } from "../lib/glossaryLookup";
import type { LoadedData } from "../lib/atlasHelpers";

const findCousinDocs = vi.fn();
vi.mock("../lib/cousins", () => ({
  findCousinDocs: (...a: unknown[]) => findCousinDocs(...a),
}));

beforeEach(() => {
  vi.resetModules();
  findCousinDocs.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function node(overrides: Partial<AtlasNode> & { id: string; doc_no: string }): AtlasNode {
  return {
    title: "Title",
    type: "Core",
    depth: 1,
    parentId: null,
    content: "",
    order: 0,
    addressRefs: [],
    ...overrides,
  };
}

const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const UUID_C = "33333333-3333-3333-3333-333333333333";

function makeData(overrides?: Partial<LoadedData>): LoadedData {
  const target = node({
    id: UUID_A,
    doc_no: "A.3",
    content: `See [Doc B](${UUID_B}) and [Doc C](${UUID_C}). Mentions Governance Facilitator.`,
    addressRefs: ["0xabc"],
  });
  const docB = node({ id: UUID_B, doc_no: "A.10", title: "Doc B" });
  const docC = node({ id: UUID_C, doc_no: "A.2", title: "Doc C" });
  const glossary: Glossary = {
    "Governance Facilitator": [
      {
        term: "Governance Facilitator",
        content: "def",
        nodeId: "g1",
        docNo: "A.0.3.1",
        sourceDocNo: "A.0.3.1",
        sourceContext: null,
      },
    ],
  };
  return {
    atlas: {
      docs: { [UUID_A]: target, [UUID_B]: docB, [UUID_C]: docC },
      docNoToId: new Map(),
    } as unknown as LoadedData["atlas"],
    flatNodes: [],
    addresses: { "0xabc": { chain: "mainnet", label: "Foo" } as AddressInfo },
    chainState: { values: { "0xabc": { balance: { raw: "1", formatted: "1" } } } as never },
    glossary,
    complete: true,
    ...overrides,
  };
}

describe("useNodeAnnotations", () => {
  it("returns the empty shape when data is null", async () => {
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations("some-id", null, null));
    expect(result.current).toEqual({
      linkedNodes: [],
      targetAddresses: {},
      chainValues: {},
      glossaryTerms: [],
      cousinDocs: [],
    });
  });

  it("returns the empty shape when id is empty", async () => {
    const data = makeData();
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations("", data, null));
    expect(result.current.linkedNodes).toEqual([]);
  });

  it("returns the empty shape when the target id isn't in docs", async () => {
    const data = makeData();
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations("missing", data, null));
    expect(result.current.linkedNodes).toEqual([]);
  });

  it("extracts and sorts linked nodes by doc_no numerically", async () => {
    const data = makeData();
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, null));
    expect(result.current.linkedNodes.map((n) => n.doc_no)).toEqual(["A.2", "A.10"]);
  });

  it("resolves targetAddresses and chainValues from addressRefs", async () => {
    const data = makeData();
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, null));
    expect(result.current.targetAddresses["0xabc"]).toEqual({ chain: "mainnet", label: "Foo" });
    expect(result.current.chainValues["0xabc"]).toEqual({ balance: { raw: "1", formatted: "1" } });
  });

  it("skips addresses/chain values with no matching entry", async () => {
    const data = makeData({ addresses: {}, chainState: { values: {} } });
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, null));
    expect(result.current.targetAddresses).toEqual({});
    expect(result.current.chainValues).toEqual({});
  });

  it("finds glossary terms mentioned in the node content, case-insensitively", async () => {
    const data = makeData();
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, null));
    expect(result.current.glossaryTerms).toHaveLength(1);
    expect(result.current.glossaryTerms[0][0].term).toBe("Governance Facilitator");
  });

  it("finds no glossary terms when the content doesn't mention any", async () => {
    const data = makeData();
    (data.atlas.docs[UUID_A] as AtlasNode).content = "nothing relevant here";
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, null));
    expect(result.current.glossaryTerms).toEqual([]);
  });

  it("leaves cousinDocs empty when graph is null", async () => {
    const data = makeData();
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, null));
    expect(result.current.cousinDocs).toEqual([]);
    expect(findCousinDocs).not.toHaveBeenCalled();
  });

  it("delegates to findCousinDocs when graph is present", async () => {
    const data = makeData();
    const cousins = [{ id: "cousin-1" }];
    findCousinDocs.mockReturnValue(cousins);
    const graph = { instances: [], invocations: [], primitives: [] } as never;
    const { useNodeAnnotations } = await import("./useNodeAnnotations");
    const { result } = renderHook(() => useNodeAnnotations(UUID_A, data, graph));
    expect(findCousinDocs).toHaveBeenCalledWith(UUID_A, data.atlas, graph);
    expect(result.current.cousinDocs).toBe(cousins);
  });
});
