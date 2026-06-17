import type {
  ResolvedEdge,
  GraphEntity,
  RelationEdge,
  GraphWorkerOutMessage,
} from "../types";
import { fetchJson } from "./verify";

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

export function loadGraph(base: string = import.meta.env.BASE_URL): Promise<GraphData> {
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

function getWorker(): Worker {
  if (worker) return worker;

  worker = new Worker(new URL("../workers/graph.worker.ts", import.meta.url), { type: "module" });

  worker.addEventListener("message", (e: MessageEvent<GraphWorkerOutMessage>) => {
    const msg = e.data;

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
  return new Promise((resolve) => {
    edgePending.set(id, resolve);
    w.postMessage({ type: "edges", id });
  });
}

export async function constellationQuery(
  id: number,
  q: string,
): Promise<{ neighborIds: string[]; topId: string | null }> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve) => {
    queryPending.set(id, resolve);
    w.postMessage({ type: "constellation-query", id, q });
  });
}

export async function constellationCluster(agentId: string): Promise<string[]> {
  const w = getWorker();
  await whenReady();
  return new Promise((resolve) => {
    clusterPending.set(agentId, resolve);
    w.postMessage({ type: "constellation-cluster", agentId });
  });
}
