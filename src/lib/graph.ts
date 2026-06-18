import type {
  ResolvedEdge,
  GraphEntity,
  RelationEdge,
  GraphWorkerOutMessage,
} from "../types";
import { fetchJson } from "./verify";
import { liveAtlasBase, handledStale, handledStaleMessage } from "./atlasBase";

export interface GraphData {
  participants: GraphEntity[];
  instances: GraphEntity[];
  invocations: GraphEntity[];
  primitives: GraphEntity[];
  edges: RelationEdge[];
}

export interface ConstellationInit {
  entities: GraphEntity[];
  entityEdges: RelationEdge[];
}

// Module-level cache for the raw graph data (used by reports/radar).
// Cache the raw graph data per data-source base (used by reports/radar). A
// preview passes its bundle base ("/api/preview/<sha>/") so radar renders the
// proposed atlas; default is the live atlas under BASE_URL.
const graphCache = new Map<string, Promise<GraphData>>();

export function loadGraph(base: string = liveAtlasBase()): Promise<GraphData> {
  let cached = graphCache.get(base);
  if (!cached) {
    cached = fetchJson<{ entities: GraphEntity[]; edges: RelationEdge[] }>(
      `${base}relations.json`,
      "relations.json",
    ).then((data) => ({
      participants: data.entities.filter(
        (e) => e.et !== "instance" && e.et !== "invocation" && e.et !== "primitive",
      ),
      instances: data.entities.filter((e) => e.et === "instance"),
      invocations: data.entities.filter((e) => e.et === "invocation"),
      primitives: data.entities.filter((e) => e.et === "primitive"),
      edges: data.edges,
    })).catch((err) => {
      graphCache.delete(base);
      // Stale pinned sha → force-forward; return a never-resolving promise so no
      // error UI flashes before the reload swaps in fresh URLs.
      if (handledStale(err)) return new Promise<GraphData>(() => {});
      throw err;
    });
    graphCache.set(base, cached);
  }
  return cached;
}

export interface EdgeResult {
  outbound: ResolvedEdge[];
  inbound: ResolvedEdge[];
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let ready = false;
const readyCallbacks: Array<() => void> = [];

// Constellation init — resolved once from the worker's ready payload.
let constellationInit: ConstellationInit | null = null;
const constellationInitWaiters: Array<(d: ConstellationInit) => void> = [];

// Pending callbacks keyed by request id / agent id.
const edgePending = new Map<string, (r: EdgeResult) => void>();
const queryPending = new Map<number, (r: { neighborIds: string[]; topId: string | null }) => void>();
const clusterPending = new Map<string, (ids: string[]) => void>();

// If the worker dies mid-request the response never arrives, leaking the pending
// callback and hanging the awaiting promise forever. Register every request with
// a timeout that clears the entry and rejects, so callers can recover.
const REQUEST_TIMEOUT_MS = 5000;

function registerPending<K, V>(
  map: Map<K, (v: V) => void>,
  key: K,
  resolve: (v: V) => void,
  reject: (e: Error) => void,
  label: string,
): void {
  const timer = setTimeout(() => {
    map.delete(key);
    reject(new Error(`graph worker ${label} request (${String(key)}) timed out`));
  }, REQUEST_TIMEOUT_MS);
  map.set(key, (v: V) => {
    clearTimeout(timer);
    resolve(v);
  });
}

function getWorker(): Worker {
  if (worker) return worker;

  // Thread the live atlas base via the worker `name` (read as self.name) — same
  // pattern as the atlas/search workers — so the worker fetches the sha-keyed
  // relations.json. Inline `new Worker(new URL(...))` so Vite compiles it.
  worker = new Worker(new URL("../workers/graph.worker.ts", import.meta.url), {
    type: "module",
    name: liveAtlasBase(),
  });

  worker.addEventListener("message", (e: MessageEvent<GraphWorkerOutMessage>) => {
    const msg = e.data;

    if (msg.type === "error") {
      // Stale pinned sha (404 on the sha-keyed relations.json) → force-forward.
      if (!handledStaleMessage(msg.message)) console.error("[graph]", msg.message);
      return;
    }

    if (msg.type === "ready") {
      constellationInit = { entities: msg.entities, entityEdges: msg.entityEdges };
      for (const cb of constellationInitWaiters) cb(constellationInit);
      constellationInitWaiters.length = 0;
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

    if (msg.type === "constellation-query") {
      const cb = queryPending.get(msg.id);
      if (cb) { queryPending.delete(msg.id); cb({ neighborIds: msg.neighborIds, topId: msg.topId }); }
      return;
    }

    if (msg.type === "constellation-cluster") {
      const cb = clusterPending.get(msg.agentId);
      if (cb) { clusterPending.delete(msg.agentId); cb(msg.clusterIds); }
      return;
    }
  });

  return worker;
}

function whenReady(): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve) => readyCallbacks.push(resolve));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getConstellationInit(): Promise<ConstellationInit> {
  getWorker();
  if (constellationInit) return Promise.resolve(constellationInit);
  return new Promise((resolve) => constellationInitWaiters.push(resolve));
}

export async function getEdges(id: string): Promise<EdgeResult> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve, reject) => {
    registerPending(edgePending, id, resolve, reject, "edges");
    w.postMessage({ type: "edges", id });
  });
}

export async function constellationQuery(
  id: number,
  q: string,
): Promise<{ neighborIds: string[]; topId: string | null }> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve, reject) => {
    registerPending(queryPending, id, resolve, reject, "constellation-query");
    w.postMessage({ type: "constellation-query", id, q });
  });
}

export async function constellationCluster(agentId: string): Promise<string[]> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve, reject) => {
    registerPending(clusterPending, agentId, resolve, reject, "constellation-cluster");
    w.postMessage({ type: "constellation-cluster", agentId });
  });
}
