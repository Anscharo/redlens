// Shared L2 test fixtures. Factory functions that build the minimal shapes the
// reader components consume (AtlasNode, FlatEntry, LoadedData, SearchHit, …) so
// individual tests only spell out the fields they actually exercise. Every
// factory takes a partial override and deep-merges it over a sane default.

import type { AtlasNode, AddressInfo, SearchHit, ResolvedEdge, GraphEntity } from "@/types";
import type { AtlasBundle } from "@/lib/docs";
import type { EdgeResult, GraphData } from "@/lib/graph";
import type { GlossaryEntry } from "@/lib/glossary";
import type { FlatEntry, LoadedData } from "@/lib/atlasHelpers";

// Not reset between tests on purpose: generated UUIDs are only ever compared to
// themselves (a node's own id), never to a hardcoded value, so monotonic is fine.
let uuidSeq = 0;
// Deterministic, valid-shaped UUID so address/uuid regexes in the renderer match.
export function fakeUuid(): string {
  const n = (++uuidSeq).toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${n}`;
}

export function makeNode(overrides: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id: overrides.id ?? fakeUuid(),
    doc_no: "A.1.2",
    title: "Test Node",
    type: "Core",
    depth: 3,
    parentId: null,
    content: "Body content",
    contentHash: "",
    order: 0,
    addressRefs: [],
    ...overrides,
  };
}

export function makeFlatEntry(overrides: Partial<FlatEntry> = {}): FlatEntry {
  const node = overrides.node ?? makeNode();
  return {
    node,
    depth: node.depth,
    color: "var(--depth-3)",
    hasContent: !!node.content,
    ...overrides,
  };
}

// Builds an AtlasBundle (docs + byParent + docNoToId) from a flat node list,
// wiring the lookup maps the way build-index does so loaders behave normally.
export function makeAtlasBundle(nodes: AtlasNode[] = [makeNode()]): AtlasBundle {
  const docs: Record<string, AtlasNode> = {};
  const byParent = new Map<string | null, AtlasNode[]>();
  const docNoToId = new Map<string, string>();
  for (const n of nodes) {
    docs[n.id] = n;
    docNoToId.set(n.doc_no, n.id);
    const bucket = byParent.get(n.parentId) ?? [];
    bucket.push(n);
    byParent.set(n.parentId, bucket);
  }
  return { docs, byParent, docNoToId, atlasCommit: null };
}

export function makeGraphEntity(overrides: Partial<GraphEntity> = {}): GraphEntity {
  return { id: "e-x", slug: "x", name: "X", et: "instance", st: "token", did: null, ...overrides };
}

export function makeGraphData(overrides: Partial<GraphData> = {}): GraphData {
  return { participants: [], instances: [], invocations: [], primitives: [], edges: [], ...overrides };
}

export function makeLoadedData(overrides: Partial<LoadedData> = {}): LoadedData {
  const atlas = overrides.atlas ?? makeAtlasBundle();
  const flatNodes =
    overrides.flatNodes ?? Object.values(atlas.docs).map((node) => makeFlatEntry({ node }));
  return {
    atlas,
    flatNodes,
    addresses: null,
    chainState: null,
    glossary: null,
    complete: true,
    ...overrides,
  };
}

export function makeSearchHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    id: overrides.id ?? fakeUuid(),
    score: 1,
    doc_no: "A.1.2",
    title: "Test Node",
    type: "Core",
    depth: 3,
    parentId: null,
    snippet: "a <mark>match</mark> here",
    titleHtml: "Test Node",
    matchReason: "content",
    ...overrides,
  };
}

export function makeAddressInfo(overrides: Partial<AddressInfo> = {}): AddressInfo {
  const chain = overrides.chain ?? "ethereum";
  return {
    chain,
    chains: [chain],
    explorerUrl: "https://etherscan.io/address/0x0",
    label: null,
    isContract: true,
    isProxy: false,
    roles: [],
    aliases: [],
    expectedTokens: [],
    ...overrides,
  };
}

export function makeEdge(overrides: Partial<ResolvedEdge> = {}): ResolvedEdge {
  return {
    f: fakeUuid(),
    ft: "doc",
    t: fakeUuid(),
    tt: "doc",
    e: "depends_on",
    ...overrides,
  };
}

export function makeEdgeResult(overrides: Partial<EdgeResult> = {}): EdgeResult {
  return { outbound: [], inbound: [], ...overrides };
}

export function makeGlossaryEntry(overrides: Partial<GlossaryEntry> = {}): GlossaryEntry {
  return {
    term: "Accord",
    content: "A binding agreement.",
    nodeId: fakeUuid(),
    docNo: "A.1.2",
    sourceDocNo: "A.1.2",
    sourceContext: null,
    ...overrides,
  };
}
