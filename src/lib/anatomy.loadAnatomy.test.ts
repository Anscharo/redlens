import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AtlasNode } from "../types";
import type { Glossary } from "./glossaryLookup";
import type { AnatomyInputs } from "./anatomyShape";

// loadAnatomy composes loadAtlas + loadGlossary + computeAnatomy behind a
// base-keyed cache (mirrors ConceptCensus.test.tsx's approach to loadAtlas,
// and AnatomyGlossary.test.tsx's approach to loadGlossary). computeAnatomy's
// own logic is exercised thoroughly in anatomyShape.test.ts (its default
// GROUPS reference real production UUIDs a synthetic fixture won't have) —
// this file only checks that loadAnatomy wires its two data sources and the
// per-base cache correctly, so computeAnatomy is stubbed to echo its inputs.
const loadAtlasCalls = vi.fn();
let loadAtlasImpl: (base: string) => Promise<{ docs: Record<string, AtlasNode>; atlasCommit?: string | null }> = () =>
  Promise.reject(new Error("not configured"));
vi.mock("./docs", () => ({
  loadAtlas: (base: string) => {
    loadAtlasCalls(base);
    return loadAtlasImpl(base);
  },
}));

const loadGlossaryCalls = vi.fn();
let loadGlossaryImpl: (base: string) => Promise<Glossary> = () => Promise.reject(new Error("not configured"));
vi.mock("./glossary", () => ({
  loadGlossary: (base: string) => {
    loadGlossaryCalls(base);
    return loadGlossaryImpl(base);
  },
}));

const computeAnatomyCalls = vi.fn();
vi.mock("./anatomyShape", () => ({
  computeAnatomy: (inputs: AnatomyInputs) => {
    computeAnatomyCalls(inputs);
    return {
      atlasCommit: inputs.atlasCommit,
      totals: { docs: Object.keys(inputs.nodes).length, bytes: 0, glossaryTerms: inputs.glossaryTerms },
      docTypes: [],
      scopeTree: [],
      neededResearch: [],
      chunkTree: [],
    };
  },
}));

import { loadAnatomy } from "./anatomy";

let order = 0;
const mk = (doc_no: string, type = "Scope"): AtlasNode => ({
  id: `id-${doc_no}`,
  doc_no,
  title: `T ${doc_no}`,
  type,
  depth: 1,
  parentId: null,
  content: "x",
  order: order++,
  addressRefs: [],
});

const docsFixture: Record<string, AtlasNode> = { "id-A.0": mk("A.0") };
const glossaryFixture: Glossary = { term: [{ term: "Term", content: "c", nodeId: "id-A.0", docNo: "A.0", sourceDocNo: "A.0", sourceContext: null }] };

let baseSeq = 0;
const freshBase = () => `/api/test-anatomy-base-${++baseSeq}/`;

beforeEach(() => {
  loadAtlasCalls.mockClear();
  loadGlossaryCalls.mockClear();
  computeAnatomyCalls.mockClear();
  loadAtlasImpl = () => Promise.resolve({ docs: docsFixture, atlasCommit: "sha1234" });
  loadGlossaryImpl = () => Promise.resolve(glossaryFixture);
});

describe("loadAnatomy", () => {
  it("composes loadAtlas + loadGlossary into a computeAnatomy projection", async () => {
    const data = await loadAnatomy(freshBase());
    expect(data.atlasCommit).toBe("sha1234");
    expect(data.totals.docs).toBe(1);
    expect(data.totals.glossaryTerms).toBe(1);
  });

  it("falls back to 'unknown' when the bundle carries no atlasCommit", async () => {
    loadAtlasImpl = () => Promise.resolve({ docs: docsFixture, atlasCommit: null });
    const data = await loadAnatomy(freshBase());
    expect(data.atlasCommit).toBe("unknown");
  });

  it("caches per base — a second call with the same base does not refetch", async () => {
    const base = freshBase();
    await loadAnatomy(base);
    await loadAnatomy(base);
    expect(loadAtlasCalls).toHaveBeenCalledTimes(1);
    expect(loadGlossaryCalls).toHaveBeenCalledTimes(1);
  });

  it("fetches independently per distinct base", async () => {
    const baseA = freshBase();
    const baseB = freshBase();
    await loadAnatomy(baseA);
    await loadAnatomy(baseB);
    expect(loadAtlasCalls.mock.calls.map((c) => c[0])).toEqual([baseA, baseB]);
  });

  it("does not cache a rejection — a later call retries instead of hanging on the failed promise", async () => {
    const base = freshBase();
    loadAtlasImpl = () => Promise.reject(new Error("network down"));
    await expect(loadAnatomy(base)).rejects.toThrow("network down");

    loadAtlasImpl = () => Promise.resolve({ docs: docsFixture, atlasCommit: "recovered" });
    const data = await loadAnatomy(base);
    expect(data.atlasCommit).toBe("recovered");
    expect(loadAtlasCalls).toHaveBeenCalledTimes(2);
  });
});
