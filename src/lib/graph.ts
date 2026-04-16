import type { ResolvedEdge, RelationEntity, RelationEdge, GraphWorkerOutMessage, SerializedSubgraph } from "../types";

export interface GraphData {
  entities: RelationEntity[];
  edges: RelationEdge[];
}

// Module-level cache for the raw graph data (used by reports)
let graphCache: Promise<GraphData> | null = null;

/** Load the full relations.json once and cache it. Used by reports that need bulk data. */
export function loadGraph(): Promise<GraphData> {
  if (!graphCache) {
    graphCache = fetch(`${import.meta.env.BASE_URL}relations.json`)
      .then(r => r.json() as Promise<{ entities: RelationEntity[]; edges: RelationEdge[] }>)
      .then(data => ({ entities: data.entities, edges: data.edges }));
  }
  return graphCache;
}

export interface EdgeResult {
  outbound: ResolvedEdge[];
  inbound:  ResolvedEdge[];
}

export interface EntityResult {
  entity: RelationEntity | null;
  edges:  ResolvedEdge[];
}

// ---------------------------------------------------------------------------
// Worker lifecycle — started lazily on first call, kept alive for the session
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let ready = false;
const readyCallbacks: Array<() => void> = [];

// Pending query callbacks keyed by request id
const edgePending     = new Map<string, (r: EdgeResult) => void>();
const entityPending   = new Map<string, (r: EntityResult) => void>();
const subgraphPending = new Map<string, (r: SerializedSubgraph) => void>();

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(
    new URL("../workers/graph.worker.ts", import.meta.url),
    { type: "module" }
  );

  worker.addEventListener("message", (e: MessageEvent<GraphWorkerOutMessage>) => {
    const msg = e.data;

    if (msg.type === "ready") {
      ready = true;
      for (const cb of readyCallbacks) cb();
      readyCallbacks.length = 0;
      return;
    }

    if (msg.type === "edges") {
      const cb = edgePending.get(msg.id);
      if (cb) { edgePending.delete(msg.id); cb({ outbound: msg.outbound, inbound: msg.inbound }); }
      return;
    }

    if (msg.type === "entity") {
      const cb = entityPending.get(msg.slug);
      if (cb) { entityPending.delete(msg.slug); cb({ entity: msg.entity, edges: msg.edges }); }
      return;
    }

    if (msg.type === "neighbors" || msg.type === "subgraph") {
      const key = msg.type === "neighbors" ? msg.id : msg.rootId;
      const cb = subgraphPending.get(key);
      if (cb) { subgraphPending.delete(key); cb({ nodes: msg.nodes, edges: msg.edges }); }
      return;
    }
  });

  return worker;
}

function whenReady(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise(resolve => readyCallbacks.push(resolve));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Get all inbound + outbound edges for a doc or entity id. */
export async function getEdges(id: string): Promise<EdgeResult> {
  const w = getWorker();
  await whenReady();
  return new Promise(resolve => {
    edgePending.set(id, resolve);
    w.postMessage({ type: "edges", id });
  });
}

/** Get an entity by slug, plus all its edges. */
export async function getEntity(slug: string): Promise<EntityResult> {
  const w = getWorker();
  await whenReady();
  return new Promise(resolve => {
    entityPending.set(slug, resolve);
    w.postMessage({ type: "entity", slug });
  });
}

/** BFS neighbors up to `depth` hops (default 1). Returns serialized subgraph. */
export async function getNeighbors(id: string, depth = 1): Promise<SerializedSubgraph> {
  const w = getWorker();
  await whenReady();
  return new Promise(resolve => {
    subgraphPending.set(id, resolve);
    w.postMessage({ type: "neighbors", id, depth });
  });
}

/** BFS subgraph rooted at `rootId` to `depth` hops — for visualization. */
export async function getSubgraph(rootId: string, depth: number): Promise<SerializedSubgraph> {
  const w = getWorker();
  await whenReady();
  return new Promise(resolve => {
    subgraphPending.set(rootId, resolve);
    w.postMessage({ type: "subgraph", rootId, depth });
  });
}

/** Returns true once relations.json is loaded and indexed. */
export function isGraphReady(): boolean {
  return ready;
}
