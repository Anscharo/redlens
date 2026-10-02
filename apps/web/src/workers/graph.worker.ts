/// <reference lib="webworker" />
import { MultiDirectedGraph } from "graphology";
import { bfsFromNode } from "graphology-traversal";
import type {
  RelationEdge,
  ResolvedEdge,
  GraphEntity,
  GraphWorkerInMessage,
  GraphWorkerOutMessage,
  SerializedSubgraph,
} from "@/types";
import { fetchJson } from "@/lib/verify";

declare const self: DedicatedWorkerGlobalScope;

let graph: MultiDirectedGraph | null = null;
const entityBySlug = new Map<string, GraphEntity>();
const entityById = new Map<string, GraphEntity>();

async function init() {
  // Live atlas base threaded via the worker `name` (sha-keyed /api/atlas/<sha>/);
  // falls back to flat BASE_URL when no sha was injected (cold boot / dev).
  const base = self.name || import.meta.env.BASE_URL;
  const data = await fetchJson<{
    entities: GraphEntity[];
    edges: RelationEdge[];
  }>(`${base}relations.json`, "relations.json");

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

function post(msg: GraphWorkerOutMessage) {
  self.postMessage(msg);
}

function resolveEdge(attrs: Record<string, unknown>, source: string, target: string): ResolvedEdge {
  const ft = graph!.getNodeAttribute(source, "_nt") as string;
  const tt = graph!.getNodeAttribute(target, "_nt") as string;
  const fromEntity = ft === "entity" ? entityById.get(source) : undefined;
  const toEntity = tt === "entity" ? entityById.get(target) : undefined;
  return {
    f: source, t: target, ft, tt,
    e: attrs.type as string,
    s: (attrs.s as string[]) ?? undefined,
    m: (attrs.m as string) ?? undefined,
    from_label: fromEntity?.name,
    from_did: fromEntity?.did ?? undefined,
    to_label: toEntity?.name,
    to_did: toEntity?.did ?? undefined,
  };
}

function edgesFor(id: string): { outbound: ResolvedEdge[]; inbound: ResolvedEdge[] } {
  if (!graph || !graph.hasNode(id)) return { outbound: [], inbound: [] };
  const outbound: ResolvedEdge[] = [];
  const inbound: ResolvedEdge[] = [];
  graph.forEachOutEdge(id, (_, attrs, source, target) => outbound.push(resolveEdge(attrs, source, target)));
  graph.forEachInEdge(id, (_, attrs, source, target) => inbound.push(resolveEdge(attrs, source, target)));
  return { outbound, inbound };
}

function buildSubgraph(rootId: string, depth: number): SerializedSubgraph {
  if (!graph || !graph.hasNode(rootId)) return { nodes: [], edges: [] };
  const included = new Set<string>();
  bfsFromNode(graph, rootId, (node, _attrs, d) => {
    included.add(node);
    if (d >= depth) return true;
  });
  const nodes = [...included].map((id) => ({
    id,
    attrs: graph!.getNodeAttributes(id) as Record<string, unknown>,
  }));
  const edges: SerializedSubgraph["edges"] = [];
  graph.forEachEdge((key, attrs, src, tgt) => {
    if (included.has(src) && included.has(tgt))
      edges.push({ key, src, tgt, attrs: attrs as Record<string, unknown> });
  });
  return { nodes, edges };
}

self.addEventListener("message", (e: MessageEvent<GraphWorkerInMessage>) => {
  const msg = e.data;
  try {
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
  } catch (err) {
    if (msg.type === "edges") post({ type: "edges", id: msg.id, outbound: [], inbound: [] });
    if (msg.type === "entity") post({ type: "entity", slug: msg.slug, entity: null, edges: [] });
    if (msg.type === "neighbors") post({ type: "neighbors", id: msg.id, nodes: [], edges: [] });
    if (msg.type === "subgraph") post({ type: "subgraph", rootId: msg.rootId, nodes: [], edges: [] });
    console.error("[graph worker]", err);
  }
});

init().catch((err) => post({ type: "error", message: String(err) }));
