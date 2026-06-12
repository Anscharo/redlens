// In-memory atlas indexes, loaded once from build artifacts at boot.
//   - docMap / byDocNo / childrenIndex  ← public/docs.json
//   - MiniSearch (lexical)              ← public/docs.json
//   - graphology MultiDirectedGraph     ← public/graph.json (full backend graph)
//   - raw entity/edge arrays + adjacency maps for aggregate queries
// Doc content lives here (not in Postgres); semantic search returns ids that
// these maps resolve back to full nodes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import { MultiDirectedGraph } from "graphology";
import { config } from "./config.ts";

export interface AtlasNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  order: number;
  content: string;
  contentHash?: string;
  addressRefs?: string[];
}

export interface Entity {
  id: string;
  slug: string;
  name: string;
  entity_type: string;
  subtype: string | null;
  defining_doc_id: string | null;
  is_active: number;
  meta: string | null;
}

export interface Edge {
  id: number;
  from_id: string;
  from_type: string; // doc | entity | address
  to_id: string;
  to_type: string;
  edge_type: string;
  source_doc_nos: string | null;
  weight: number;
  meta: string | null;
}

export interface Ancestor {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
}

// KEEP IN SYNC with src/workers/search.worker.ts AND scripts/required/build-index.mjs
// MINISEARCH_OPTIONS: the server deserializes the prebuilt search-index.json via
// loadJSON, which requires options identical to the build. No storeFields —
// lexical search reads only id+score (search.ts) and resolves docs via docMap.
const MINISEARCH_OPTIONS: ConstructorParameters<typeof MiniSearch>[0] = {
  fields: ["title", "doc_no", "type", "content"],
  idField: "id",
  processTerm: (term) => {
    const lower = term.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "").toLowerCase();
    return lower.length >= 2 ? lower : null;
  },
};

export interface Indexes {
  docMap: Map<string, AtlasNode>;
  byDocNo: Map<string, AtlasNode>;
  childrenIndex: Map<string, AtlasNode[]>;
  mini: MiniSearch;
  graph: MultiDirectedGraph;
  entities: Entity[];
  edges: Edge[];
  entityBySlug: Map<string, Entity>;
  entityById: Map<string, Entity>;
  meta: Record<string, string | null>;
}

let state: Indexes | null = null;

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(join(config.publicDir, file), "utf8")) as T;
}

export interface Artifacts {
  docs: AtlasNode[];
  entities: Entity[];
  edges: Edge[];
  meta: Record<string, string | null>;
  // Serialized MiniSearch index (build-index `toJSON`). null → build from docs.
  searchIndexJson: string | null;
}

export function readArtifactsFromDisk(): Artifacts {
  const rawDocs = readJson<Record<string, AtlasNode>>("docs.json");
  const graphJson = readJson<{ meta?: Record<string, unknown>; entities: Entity[]; edges: Edge[] }>("graph.json");

  let searchIndexJson: string | null = null;
  try {
    searchIndexJson = readFileSync(join(config.publicDir, "search-index.json"), "utf8");
  } catch {
    searchIndexJson = null; // fall back to building from docs
  }

  let meta: Record<string, string | null> = {};
  try {
    const m = readJson<{ atlasCommit?: string; redlensCommit?: string; generatedAt?: string }>("manifest.json");
    meta = {
      atlasCommit: m.atlasCommit ?? null,
      redlensCommit: m.redlensCommit ?? null,
      generatedAt: m.generatedAt ?? null,
    };
  } catch {
    meta = {};
  }
  return { docs: Object.values(rawDocs), entities: graphJson.entities, edges: graphJson.edges, meta, searchIndexJson };
}

// Pure builder: construct the full in-memory index set from artifact arrays.
// Shared by the boot load and any full rebuild + setIndexes (the in-process
// self-updater's full-rebuild path — see docs/plans/atlas-runtime-freshness-inprocess.md).
export function buildIndexes(
  docs: AtlasNode[],
  entities: Entity[],
  edges: Edge[],
  meta: Record<string, string | null>,
  searchIndexJson?: string | null,
): Indexes {
  const docMap = new Map<string, AtlasNode>();
  const byDocNo = new Map<string, AtlasNode>();
  const childrenIndex = new Map<string, AtlasNode[]>();
  for (const d of docs) {
    docMap.set(d.id, d);
    byDocNo.set(d.doc_no, d);
    if (d.parentId) {
      const arr = childrenIndex.get(d.parentId);
      if (arr) arr.push(d);
      else childrenIndex.set(d.parentId, [d]);
    }
  }
  for (const arr of childrenIndex.values()) arr.sort((a, b) => a.order - b.order);

  // Prefer the prebuilt serialized index (cheap deserialize, no re-tokenization);
  // fall back to building from docs (tests / synthetic sets with no artifact).
  let mini: MiniSearch;
  if (searchIndexJson) {
    mini = MiniSearch.loadJSON(searchIndexJson, MINISEARCH_OPTIONS);
  } else {
    mini = new MiniSearch(MINISEARCH_OPTIONS);
    mini.addAll(docs);
  }

  const { graph, entityBySlug, entityById } = buildGraph(docs, entities, edges);

  return { docMap, byDocNo, childrenIndex, mini, graph, entities, edges, entityBySlug, entityById, meta };
}

// graphology + entity lookup maps from the entity/edge arrays. Extracted so the
// in-place updater can rebuild the graph from a fresh graph.json and reassign it
// on the live indexes (relation extraction happens in the build subprocess; this
// in-memory construction is cheap). Every addressable thing is a node; edges
// carry full attrs so query_atlas can filter on edge_type + endpoint node-type.
export function buildGraph(
  docs: AtlasNode[],
  entities: Entity[],
  edges: Edge[],
): { graph: MultiDirectedGraph; entityBySlug: Map<string, Entity>; entityById: Map<string, Entity> } {
  const entityBySlug = new Map<string, Entity>();
  const entityById = new Map<string, Entity>();
  for (const e of entities) {
    entityBySlug.set(e.slug, e);
    entityById.set(e.id, e);
  }
  const graph = new MultiDirectedGraph();
  for (const d of docs) graph.addNode(d.id, { _nt: "doc" });
  for (const e of entities) if (!graph.hasNode(e.id)) graph.addNode(e.id, { _nt: "entity" });
  for (const edge of edges) {
    if (!graph.hasNode(edge.from_id)) graph.addNode(edge.from_id, { _nt: edge.from_type });
    if (!graph.hasNode(edge.to_id)) graph.addNode(edge.to_id, { _nt: edge.to_type });
    graph.addDirectedEdgeWithKey(String(edge.id), edge.from_id, edge.to_id, {
      edge_type: edge.edge_type,
      source_doc_nos: edge.source_doc_nos,
      weight: edge.weight,
      meta: edge.meta,
      from_type: edge.from_type,
      to_type: edge.to_type,
    });
  }
  return { graph, entityBySlug, entityById };
}

export function loadIndexes(): Indexes {
  if (state) return state;
  const { docs, entities, edges, meta, searchIndexJson } = readArtifactsFromDisk();
  state = buildIndexes(docs, entities, edges, meta, searchIndexJson);
  return state;
}

// Atomically replace the live index set. A plain reference assignment — atomic on
// the single-threaded event loop: in-flight requests holding the prior reference
// keep a consistent snapshot; new requests see the new set. This is the swap half
// of the in-process self-updater's full-rebuild path.
export function setIndexes(ix: Indexes): void {
  state = ix;
}

// Full rebuild from freshly-regenerated on-disk artifacts, then atomic swap. The
// self-updater's correct, ship-first path (no per-doc diffing). `meta.atlasCommit`
// advances automatically because it's re-read from the rebuilt manifest.json —
// the convergence signal the drift checker compares against.
export function rebuildFromDisk(): Indexes {
  const { docs, entities, edges, meta, searchIndexJson } = readArtifactsFromDisk();
  const ix = buildIndexes(docs, entities, edges, meta, searchIndexJson);
  setIndexes(ix);
  return ix;
}

export function getIndexes(): Indexes {
  if (!state) throw new Error("indexes not loaded — call loadIndexes() at boot");
  return state;
}

// Resolve a UUID or doc_no to a node.
export function resolveNode(ix: Indexes, idOrDocNo: string): AtlasNode | undefined {
  return ix.docMap.get(idOrDocNo) ?? ix.byDocNo.get(idOrDocNo);
}

// Ancestor chain: parent → … → root.
export function ancestorChain(ix: Indexes, id: string): Ancestor[] {
  const out: Ancestor[] = [];
  let node = ix.docMap.get(id);
  let cur = node?.parentId ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const p = ix.docMap.get(cur);
    if (!p) break;
    out.push({ id: p.id, doc_no: p.doc_no, title: p.title, type: p.type, depth: p.depth });
    cur = p.parentId;
  }
  return out;
}

// All descendant ids under a node (inclusive of the node itself).
export function descendantIds(ix: Indexes, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of ix.childrenIndex.get(cur) ?? []) {
      if (!out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return out;
}
