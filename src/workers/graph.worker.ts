/// <reference lib="webworker" />
import type { RelationEdge, ResolvedEdge, RelationEntity, GraphWorkerInMessage, GraphWorkerOutMessage } from "../types";

declare const self: DedicatedWorkerGlobalScope;

// Indexed in-memory graph — built once on init, queried many times
const outbound = new Map<string, RelationEdge[]>(); // from_id → edges
const inbound  = new Map<string, RelationEdge[]>(); // to_id   → edges
const entityBySlug = new Map<string, RelationEntity>();
const entityById   = new Map<string, RelationEntity>();

function addOut(id: string, edge: RelationEdge) {
  const arr = outbound.get(id);
  if (arr) arr.push(edge);
  else outbound.set(id, [edge]);
}

function addIn(id: string, edge: RelationEdge) {
  const arr = inbound.get(id);
  if (arr) arr.push(edge);
  else inbound.set(id, [edge]);
}

async function init() {
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}relations.json`);
  const data = await res.json() as {
    entities: RelationEntity[];
    edges: RelationEdge[];
  };

  for (const entity of data.entities) {
    entityBySlug.set(entity.slug, entity);
    entityById.set(entity.id, entity);
  }

  for (const edge of data.edges) {
    addOut(edge.f, edge);
    addIn(edge.t, edge);
  }

  post({ type: "ready" });
}

function post(msg: GraphWorkerOutMessage) {
  self.postMessage(msg);
}

function resolve(edge: RelationEdge): ResolvedEdge {
  return {
    ...edge,
    from_label: edge.ft === "entity" ? entityById.get(edge.f)?.name : undefined,
    to_label:   edge.tt === "entity" ? entityById.get(edge.t)?.name : undefined,
  };
}

self.addEventListener("message", (e: MessageEvent<GraphWorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === "ping") {
    post({ type: "ready" });
    return;
  }

  if (msg.type === "edges") {
    post({
      type: "edges",
      id: msg.id,
      outbound: (outbound.get(msg.id) ?? []).map(resolve),
      inbound:  (inbound.get(msg.id)  ?? []).map(resolve),
    });
    return;
  }

  if (msg.type === "entity") {
    const entity = entityBySlug.get(msg.slug) ?? null;
    const edges: ResolvedEdge[] = [];
    if (entity) {
      for (const e of outbound.get(entity.id) ?? []) edges.push(resolve(e));
      for (const e of inbound.get(entity.id)  ?? []) edges.push(resolve(e));
    }
    post({ type: "entity", slug: msg.slug, entity, edges });
    return;
  }
});

init().catch((err) => {
  post({ type: "error", message: String(err) });
});
