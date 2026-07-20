// DOM-free graph value shapes shared by the graph worker layer (graph.ts) and
// the pure report-derivation modules. Extracted from graph.ts — which imports
// the browser-coupled worker/analytics/atlasBase layer — so server-side report
// builders can import these types without pulling the DOM into the server
// tsconfig. graph.ts re-exports both for existing frontend callers.
import type { GraphEntity, RelationEdge } from "../types";

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
