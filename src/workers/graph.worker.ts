/// <reference lib="webworker" />
import { MultiDirectedGraph } from "graphology";
import { bfsFromNode } from "graphology-traversal";
import type {
  RelationEdge, ResolvedEdge, RelationEntity,
  GraphWorkerInMessage, GraphWorkerOutMessage, SerializedSubgraph,
} from "../types";

declare const self: DedicatedWorkerGlobalScope;

let graph: MultiDirectedGraph | null = null;
const entityBySlug = new Map<string, RelationEntity>();
const entityById   = new Map<string, RelationEntity>();

async function init() {
  const base = import.meta.env.BASE_URL;
  const data = await fetch(`${base}relations.json`).then(r => r.json()) as {
    entities: RelationEntity[];
    edges: RelationEdge[];
  };

  graph = new MultiDirectedGraph();

  for (const entity of data.entities) {
    entityBySlug.set(entity.slug, entity);
    entityById.set(entity.id, entity);
    graph.addNode(entity.id, { ...entity, _nt: "entity" });
  }

  for (const edge of data.edges) {
    if (!graph.hasNode(edge.f)) graph.addNode(edge.f, { _nt: edge.ft });
    if (!graph.hasNode(edge.t)) graph.addNode(edge.t, { _nt: edge.tt });
    graph.addDirectedEdge(edge.f, edge.t, { type: edge.e, s: edge.s ?? null, m: edge.m ?? null });
  }

  post({ type: "ready" });
}

function post(msg: GraphWorkerOutMessage) { self.postMessage(msg); }

function resolveEdge(edge: RelationEdge): ResolvedEdge {
  return {
    ...edge,
    from_label: edge.ft === "entity" ? entityById.get(edge.f)?.name : undefined,
    to_label:   edge.tt === "entity" ? entityById.get(edge.t)?.name : undefined,
  };
}

/** Collect all RelationEdges for a node id from the live graph. */
function edgesFor(id: string): { outbound: ResolvedEdge[]; inbound: ResolvedEdge[] } {
  if (!graph) return { outbound: [], inbound: [] };
  const outbound: ResolvedEdge[] = [];
  const inbound:  ResolvedEdge[] = [];
  graph.forEachOutEdge(id, (_, attrs) => outbound.push(resolveEdge(attrs as RelationEdge)));
  graph.forEachInEdge(id,  (_, attrs) => inbound.push(resolveEdge(attrs as RelationEdge)));
  return { outbound, inbound };
}

/** BFS to `depth`, return a serialized subgraph the main thread can hand to sigma. */
function buildSubgraph(rootId: string, depth: number): SerializedSubgraph {
  if (!graph || !graph.hasNode(rootId)) return { nodes: [], edges: [] };

  const included = new Set<string>();
  bfsFromNode(graph, rootId, (node, _attrs, d) => {
    included.add(node);
    if (d >= depth) return true; // stop branching
  });

  const nodes = [...included].map(id => ({
    id,
    attrs: graph!.getNodeAttributes(id) as Record<string, unknown>,
  }));

  const edges: SerializedSubgraph["edges"] = [];
  graph.forEachEdge((key, attrs, src, tgt) => {
    if (included.has(src) && included.has(tgt)) {
      edges.push({ key, src, tgt, attrs: attrs as Record<string, unknown> });
    }
  });

  return { nodes, edges };
}

self.addEventListener("message", (e: MessageEvent<GraphWorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === "ping") { post({ type: "ready" }); return; }

  if (msg.type === "edges") {
    const { outbound, inbound } = edgesFor(msg.id);
    post({ type: "edges", id: msg.id, outbound, inbound });
    return;
  }

  if (msg.type === "entity") {
    const entity = entityBySlug.get(msg.slug) ?? null;
    const edges: ResolvedEdge[] = [];
    if (entity) {
      const { outbound, inbound } = edgesFor(entity.id);
      edges.push(...outbound, ...inbound);
    }
    post({ type: "entity", slug: msg.slug, entity, edges });
    return;
  }

  if (msg.type === "neighbors") {
    if (!graph) { post({ type: "neighbors", id: msg.id, nodes: [], edges: [] }); return; }
    const sub = buildSubgraph(msg.id, msg.depth ?? 1);
    post({ type: "neighbors", id: msg.id, ...sub });
    return;
  }

  if (msg.type === "subgraph") {
    const sub = buildSubgraph(msg.rootId, msg.depth);
    post({ type: "subgraph", rootId: msg.rootId, ...sub });
    return;
  }
});

init().catch(err => post({ type: "error", message: String(err) }));
