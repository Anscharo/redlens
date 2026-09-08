// In-memory atlas indexes, loaded once from build artifacts at boot.
//   - docMap / byDocNo / childrenIndex  ← public/docs.json
//   - MiniSearch (lexical)              ← public/search-index.json (loadJSON; addAll from docs as fallback)
//   - graphology MultiDirectedGraph     ← public/graph.json (full backend graph)
//   - raw entity/edge arrays + adjacency maps for aggregate queries
// Doc content lives here (not in Postgres); semantic search returns ids that
// these maps resolve back to full nodes.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import MiniSearch from "minisearch";
import { MultiDirectedGraph } from "graphology";
import { config } from "../config.ts";
import { MINISEARCH_OPTIONS } from "../../lib/searchOptions.ts";
import { buildLookup, type Glossary, type GlossaryEntry } from "../../lib/glossaryLookup.ts";
import { buildParamIndex, type ParamIndex } from "../../lib/paramIndex.ts";
import { buildLivenessMap, type Liveness } from "../../lib/liveness.ts";
import { pickAtlasCommit } from "../../../scripts/lib/atlas-commit.mjs";

// One canonical AtlasNode (src/types.ts). Re-exported so existing
// `import { AtlasNode } from "./indexes.ts"` sites keep working, but there is now
// a SINGLE declaration — the review found the duplicate (optional addressRefs
// here vs required in src/types) was what let the DB rebuild silently drop the
// field. Keep them unified.
export type { AtlasNode } from "../../types.ts";
import type { AtlasNode } from "../../types.ts";

// atlas_doc_meta row shape (after column aliasing) — the inverse of the
// nodeToDocRow write in doc-rows.ts. Shared so the in-process updater's
// DB→docs.json path stays in lockstep with the worker build and never silently
// drops a field. `contentHash` is the node_content_hash column (parser hash),
// aliased in the updater SELECT; `addressRefs` is the address_refs column.
export interface DocMetaRow {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  content: string | null;
  order: number;
  contentHash?: string | null;
  addressRefs?: string[] | null;
}

export function docRowToNode(r: DocMetaRow): AtlasNode {
  return {
    id: r.id,
    doc_no: r.doc_no,
    title: r.title,
    type: r.type,
    depth: r.depth,
    parentId: r.parentId,
    content: r.content ?? "",
    order: r.order,
    contentHash: r.contentHash ?? undefined,
    addressRefs: r.addressRefs ?? [],
  };
}

// The one DB read of DocMetaRow. Both the web updater's refresh-from-store and
// the worker's embeddings reconcile must use this — a copy-pasted SELECT that
// drops a column would rebuild docs.json (or embeddings) missing that field,
// which is the failure class DocMetaRow exists to prevent. Sha + rows come
// from one transaction so a concurrent worker commit cannot pair a new
// sync_state pointer with the previous atlas_doc_meta snapshot.
type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
interface SqlWithTx {
  begin<T>(fn: (tx: SqlTag) => Promise<T>): Promise<T>;
}

export async function loadDocMetaSnapshot(db: SqlWithTx): Promise<{ atlasSha: string | null; rows: DocMetaRow[] }> {
  return db.begin(async (tx) => {
    const st = (await tx`SELECT atlas_sha FROM sync_state WHERE id = 1`) as { atlas_sha?: string }[];
    const rows = (await tx`
      SELECT id, doc_no, title, type, depth,
             parent_id AS "parentId", content, ord AS "order",
             node_content_hash AS "contentHash", address_refs AS "addressRefs"
      FROM atlas_doc_meta ORDER BY ord
    `) as unknown as DocMetaRow[];
    return { atlasSha: st[0]?.atlas_sha ?? null, rows };
  });
}

// The docs.json envelope contract ({ atlasCommit, nodes }) read by
// readArtifactsFromDisk and the server. One writer, so the shape can't drift.
// docs.json keeps full nodes (content + contentHash) — it's the server/internal
// artifact and the bundle's diff source.
export function writeDocsJson(dir: string, atlasCommit: string, nodes: Record<string, AtlasNode>): void {
  writeFileSync(join(dir, "docs.json"), JSON.stringify({ atlasCommit, nodes }));
}

// Browser-facing split of docs.json (docs/plans/docs-split.md): split by tree DEPTH
// into docs-shallow.json (depth ≤ 5, the initial visible tree + content) and
// docs-deep.json (depth > 5, the gated bulk loaded after first paint). Each file
// holds self-contained full nodes (no positional stitching). `contentHash` stays
// server-only. MUST stay byte-shape-compatible with build-index.mjs. Preview
// still calls this; the live updater does not — docs-shallow/docs-deep come
// from the published store.
const SHALLOW_MAX_DEPTH = 5; // KEEP IN SYNC with build-index.mjs
export function writeDocsSplit(dir: string, atlasCommit: string, nodes: Record<string, AtlasNode>): void {
  const shallow: AtlasNode[] = [];
  const deep: AtlasNode[] = [];
  for (const n of Object.values(nodes)) {
    const { contentHash: _h, ...node } = n;
    (node.depth <= SHALLOW_MAX_DEPTH ? shallow : deep).push(node);
  }
  writeFileSync(join(dir, "docs-shallow.json"), JSON.stringify({ atlasCommit, nodes: shallow }));
  writeFileSync(join(dir, "docs-deep.json"), JSON.stringify({ atlasCommit, nodes: deep }));
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
  // Alias-flattened glossary lookup (lowercased term/alias → entries), built
  // from public/glossary.json. Empty when the artifact is missing — consumers
  // (chat prefetch) degrade to no glossary matches.
  glossary: Map<string, GlossaryEntry[]>;
  // Derived per index build (so they can never be stale against the served
  // docs — see docs/research/synlang-wiki.md §3.1/§3.2): the deterministic
  // constraint-parameter table and the scaffold/placeholder liveness tags.
  // Docs absent from `liveness` are settled.
  params: ParamIndex;
  liveness: Map<string, Liveness>;
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
  // public/glossary.json terms (build-glossary). null → empty glossary lookup.
  glossaryTerms: Glossary | null;
}

const EMPTY_ARTIFACTS: Artifacts = { docs: [], entities: [], edges: [], meta: {}, searchIndexJson: null, glossaryTerms: null };

export function readArtifactsFromDisk(): Artifacts {
  let rawDocs: { atlasCommit?: string; nodes: Record<string, AtlasNode> };
  let graphJson: { meta?: Record<string, unknown>; entities: Entity[]; edges: Edge[] };
  try {
    rawDocs = readJson("docs.json");
    graphJson = readJson("graph.json");
  } catch {
    // Artifacts not yet built — cold start before the worker has populated Postgres.
    // The in-process updater will detect drift and hydrate from the artifact store within 30s.
    return EMPTY_ARTIFACTS;
  }

  let searchIndexJson: string | null = null;
  try {
    searchIndexJson = readFileSync(join(config.publicDir, "search-index.json"), "utf8");
  } catch {
    searchIndexJson = null;
  }

  let glossaryTerms: Glossary | null = null;
  try {
    glossaryTerms = readJson<{ terms: Glossary }>("glossary.json").terms ?? null;
  } catch {
    glossaryTerms = null;
  }

  const meta: Record<string, string | null> = {
    // Skip the "unknown" sentinel (git rev-parse failed / runtime image has no
    // git). graph.json used to win even when it was "unknown" and docs.json
    // already held the real DB sha, so the updater never reported convergence.
    atlasCommit: pickAtlasCommit(graphJson.meta?.atlasCommit, rawDocs.atlasCommit),
    appCommit: null,
    generatedAt: null,
  };
  return { docs: Object.values(rawDocs.nodes), entities: graphJson.entities, edges: graphJson.edges, meta, searchIndexJson, glossaryTerms };
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
  glossaryTerms?: Glossary | null,
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

  const glossary = new Map(Object.entries(buildLookup(glossaryTerms ?? {})));

  // Stamp response provenance: appCommit (which build) + generatedAt (when this
  // in-memory index set was built — boot or in-process rebuild). Honor an
  // artifact-supplied value if one is ever present; otherwise fill it here.
  const stampedMeta: Record<string, string | null> = {
    ...meta,
    appCommit: meta.appCommit ?? (config.appCommit || null),
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
  };

  return {
    docMap, byDocNo, childrenIndex, mini, graph, entities, edges, entityBySlug, entityById, glossary,
    params: buildParamIndex(docMap),
    liveness: buildLivenessMap(docMap),
    meta: stampedMeta,
  };
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
  const { docs, entities, edges, meta, searchIndexJson, glossaryTerms } = readArtifactsFromDisk();
  state = buildIndexes(docs, entities, edges, meta, searchIndexJson, glossaryTerms);
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
// advances automatically because it's re-read from the rebuilt graph.json (falling
// back to docs.json) — the convergence signal the drift checker compares against.
export function rebuildFromDisk(): Indexes {
  const { docs, entities, edges, meta, searchIndexJson, glossaryTerms } = readArtifactsFromDisk();
  const ix = buildIndexes(docs, entities, edges, meta, searchIndexJson, glossaryTerms);
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
