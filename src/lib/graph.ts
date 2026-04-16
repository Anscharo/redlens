import type { ResolvedEdge, RelationEntity, GraphWorkerOutMessage } from "../types";

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
const edgePending  = new Map<string, (r: EdgeResult) => void>();
const entityPending = new Map<string, (r: EntityResult) => void>();

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

/** Returns true once relations.json is loaded and indexed. */
export function isGraphReady(): boolean {
  return ready;
}
