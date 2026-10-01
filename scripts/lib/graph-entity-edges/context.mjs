// The one object every entity-edge pattern receives. Patterns read from it and
// emit through `addEdge`; the edge array is shared, so a pattern can read edges
// emitted by patterns earlier in the registry (see patterns.mjs for the order).
import { slugify } from "../graph-patterns.mjs";

export function buildContext(allDocs, docById, docByDocNo, entityContext, addressesRaw) {
  const { entityMap } = entityContext;
  const edges = [];
  return {
    ...entityContext,
    allDocs,
    docById,
    docByDocNo,
    addressesRaw,
    edges,
    docIds: new Set(allDocs.map((d) => d.id)),
    // Bootstrap entities, always created by Phase 1.
    skyCore: entityMap.get("sky-core"),
    skyGovernance: entityMap.get("sky-governance"),
    supportFacilitators: entityMap.get("support-facilitators"),
    entityById: new Map([...entityMap.values()].map((e) => [e.id, e])),
    entityByName: (name) => entityMap.get(slugify(name)),
    addEdge(fromId, fromType, toId, toType, edgeType, sourceDocNos = [], meta = null) {
      const edge = { fromId, fromType, toId, toType, edgeType, sourceDocNos, meta };
      edges.push(edge);
      return edge;
    },
  };
}
