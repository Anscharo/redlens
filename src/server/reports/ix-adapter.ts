// Projects the server's in-memory Indexes (verbose graph.json shapes: Edge
// { from_id, edge_type, source_doc_nos, meta, … } / Entity { entity_type,
// subtype, defining_doc_id, … }) into the compact browser shapes the pure
// src/lib report modules were written against — relations.json's RelationEdge
// { f, ft, t, tt, e, s?, m? } and GraphEntity { id, slug, name, et, st, did, m? },
// plus the AtlasBundle. This lets the backend atlas_report tool reuse the
// frontend derive functions VERBATIM instead of re-implementing their
// duty-collapse / exclusion / attribution logic on the server shapes.
//
// Kept generic (a full GraphData + AtlasBundle) so the remaining planned ports
// (rewards, active_data, actors) share this one adapter.
import type { Indexes, Entity, Edge, AtlasNode } from "../indexes.ts";
import type { GraphData } from "../../lib/graphData.ts";
import type { AtlasBundle } from "../../lib/docsTypes.ts";
import type { GraphEntity, RelationEdge } from "../../types.ts";
import { parseDocNos } from "./util.ts";

function toGraphEntity(e: Entity): GraphEntity {
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    et: e.entity_type,
    st: e.subtype,
    did: e.defining_doc_id,
    // RelationEdge/GraphEntity carry meta as the raw JSON string, present only
    // when non-null (relations.json omits it otherwise) — the src/lib consumers
    // parse it themselves via lib/meta.parseMeta.
    ...(e.meta != null ? { m: e.meta } : {}),
  };
}

function toRelationEdge(e: Edge): RelationEdge {
  const s = parseDocNos(e.source_doc_nos);
  return {
    f: e.from_id,
    ft: e.from_type,
    t: e.to_id,
    tt: e.to_type,
    e: e.edge_type,
    ...(s.length ? { s } : {}),
    ...(e.meta != null ? { m: e.meta } : {}),
  };
}

// Mirror loadGraph()'s participant split (src/lib/graph.ts): instances,
// invocations, and primitives are bucketed separately; everything else is a
// "participant".
export function indexesToGraphData(ix: Indexes): GraphData {
  const entities = ix.entities.map(toGraphEntity);
  const isSpecial = (et: string) => et === "instance" || et === "invocation" || et === "primitive";
  return {
    participants: entities.filter((e) => !isSpecial(e.et)),
    instances: entities.filter((e) => e.et === "instance"),
    invocations: entities.filter((e) => e.et === "invocation"),
    primitives: entities.filter((e) => e.et === "primitive"),
    edges: ix.edges.map(toRelationEdge),
  };
}

export function indexesToBundle(ix: Indexes): AtlasBundle {
  const docs: Record<string, AtlasNode> = {};
  const byParent = new Map<string | null, AtlasNode[]>();
  const docNoToId = new Map<string, string>();
  for (const node of ix.docMap.values()) {
    docs[node.id] = node;
    docNoToId.set(node.doc_no, node.id);
    const key = node.parentId ?? null;
    const arr = byParent.get(key);
    if (arr) arr.push(node);
    else byParent.set(key, [node]);
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order);
  return { docs, byParent, docNoToId, atlasCommit: ix.meta.atlasCommit ?? null };
}
