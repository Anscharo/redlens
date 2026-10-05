// Graph navigation tools: hierarchical neighbours, typed-edge traversal,
// entity lookup by name, and global edge enumeration. Assembled into
// ATLAS_TOOLS by tool-registry.ts.
import { z } from "zod";
import { atlasNeighbors, atlasTraverse, atlasEntities, atlasEdges } from "./tools-graph.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";

export const GRAPH_TOOLS: AtlasTool[] = [
  {
    name: "atlas_neighbors",
    whenToUse:
      "You have one node and need its immediate structural context — parent, siblings, direct children (e.g. 'what else is in this section').",
    annotations: readOnlyAtlasTool("Atlas Neighbors"),
    description: "Return the hierarchical context around a node: parent, N siblings above/below, and direct children.",
    shape: {
      id: z.string().describe("Node UUID or doc_no."),
      window: z.number().int().min(0).max(32).default(8).describe("Max siblings and children to include."),
    },
    handler: (ix, a) => atlasNeighbors(ix, a.id as string, (a.window as number | undefined) ?? 8),
  },
  {
    name: "atlas_traverse",
    whenToUse:
      "You need everything reachable from a node along typed edges several hops out — indirect or chained relationships, not just direct neighbors. Start it from an entity slug when you need what an actor reaches indirectly — e.g. 2 hops with direction 'both' and no edge_type filter reaches the addresses held by the multisigs it signs and the instances it runs (a relationship hop then an address hop run in opposite directions, so a filtered or single-direction walk misses them).",
    annotations: readOnlyAtlasTool("Atlas Traverse"),
    description:
      "Traverse the graph from a node, following typed edges up to N hops. Accepts a doc UUID/doc_no OR an entity " +
      "slug/name as the start, and returns doc, entity, and on-chain address nodes. Each " +
      "result carries `hops` (BFS distance from the start node — distinct from `depth`, the node's atlas nesting), " +
      "plus the `edge_type` and `direction` ('out'|'in') of the edge that first reached it. Results 2+ hops away " +
      "also include `path`: the ordered chain of steps (edge + node) from the start node to that result.",
    shape: {
      id: z.string().describe("Starting node: doc UUID or doc_no, or an entity slug/name."),
      edge_type: z.string().optional().describe("Edge type filter (e.g. 'cites', 'responsible_party_for')."),
      hops: z.number().int().min(1).max(4).default(2),
      direction: z.enum(["out", "in", "both"]).default("out"),
    },
    handler: (ix, a) => atlasTraverse(ix, a.id as string, a.edge_type as string | undefined, (a.hops as number | undefined) ?? 2, (a.direction as "out" | "in" | "both" | undefined) ?? "out"),
  },
  {
    name: "atlas_entities",
    whenToUse:
      "You have a NAME (e.g. 'Spark Protocol') and need its entity slug, or want to browse entities by type/subtype. Call this FIRST when you lack a slug the other entity tools need.",
    annotations: readOnlyAtlasTool("Atlas Entities"),
    description:
      "Find entities by free-text name and/or structural filters — turns a name like 'Spark Protocol' into a slug " +
      "(atlas_describe no longer lists slugs). Pass `query` for fuzzy name matching (ranked, with a score), and/or " +
      "filter by `entity_type` / `subtype`. Paginated.",
    shape: {
      query: z.string().optional().describe("Free-text name to match (fuzzy, ranked). Omit to list/browse by filter."),
      entity_type: z.string().optional().describe("Filter by entity type (e.g. 'agent', 'instance', 'multisig', 'facilitator_org')."),
      subtype: z.string().optional().describe("Filter by subtype, case-insensitive substring (e.g. 'reward', 'prime')."),
      limit: z.number().int().min(1).max(500).default(50),
      offset: z.number().int().min(0).default(0),
      q: z.string().optional().describe("Deprecated alias of `query`."),
    },
    handler: (ix, a) =>
      atlasEntities(ix, {
        q: (a.query as string | undefined) ?? (a.q as string | undefined),
        entity_type: a.entity_type as string | undefined,
        subtype: a.subtype as string | undefined,
        limit: (a.limit as number | undefined) ?? 50,
        offset: (a.offset as number | undefined) ?? 0,
      }),
  },
  {
    name: "atlas_edges",
    whenToUse:
      "The question asks for EVERY relationship of a type (all signers, all integration partners) or all edges to/from one resolved entity slug.",
    annotations: readOnlyAtlasTool("Atlas Edges"),
    description:
      "Enumerate graph edges globally with pagination (e.g. signer_of, integration_partner_of, active_data_for). " +
      "Returns resolved endpoint names/types, parsed meta, source doc numbers, and optional provenance docs.",
    shape: {
      edge_type: z.string().optional().describe("Exact edge type filter, e.g. 'signer_of', 'responsible_party_for'."),
      from_type: z.enum(["doc", "entity", "address"]).optional().describe("Endpoint node kind filter."),
      to_type: z.enum(["doc", "entity", "address"]).optional().describe("Endpoint node kind filter."),
      from_slug: z.string().optional().describe("Filter to edges whose source endpoint is this entity slug."),
      to_slug: z.string().optional().describe("Filter to edges whose target endpoint is this entity slug."),
      include_docs: z.boolean().default(false).describe("Include provenance document id/title/type for source_doc_nos."),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    },
    // from_type/to_type are optional enums with no default — the shape a
    // property-filling model cannot leave blank. An invented `from_type:
    // "doc"` drops every entity-side edge, which is most of what this tool
    // exists to enumerate.
    emptyArgsAbsent: true,
    handler: (ix, a) =>
      atlasEdges(ix, {
        edge_type: a.edge_type as string | undefined,
        from_type: a.from_type as string | undefined,
        to_type: a.to_type as string | undefined,
        from_slug: a.from_slug as string | undefined,
        to_slug: a.to_slug as string | undefined,
        include_docs: (a.include_docs as boolean | undefined) ?? false,
        limit: (a.limit as number | undefined) ?? 100,
        offset: (a.offset as number | undefined) ?? 0,
      }),
  },
];
