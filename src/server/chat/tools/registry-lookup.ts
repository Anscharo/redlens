// Structured lookup tools: an entity's holdings, complete class listings,
// instance parameter maps, and the deterministic parameter table. Assembled
// into ATLAS_TOOLS by tool-registry.ts.
import { z } from "zod";
import { atlasEntity, atlasFilter, atlasEntityParams } from "./tools-graph.ts";
import { atlasParams } from "./tools-params.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";

export const LOOKUP_TOOLS: AtlasTool[] = [
  {
    name: "atlas_entity",
    whenToUse:
      "The question is about what an actor actually HAS or does — its addresses, instances, responsibilities, or Active Data. Use this instead of searching and reading titles when you need an agent's real holdings, not docs that merely mention it. This is also the one call that answers 'what addresses relate to X'.",
    annotations: readOnlyAtlasTool("Atlas Entity"),
    description:
      "Get Atlas sections related to an entity (agent, role, or actor) — resolves `name` server-side (slug or " +
      "natural language) and echoes `resolved` + `alternatives`. Returns `addresses` (every on-chain address the " +
      "entity holds, plus those held by the entities it is linked to — grouped by owner with the linking edge and " +
      "provenance doc_nos), paginated `nodes` (edge-linked docs + " +
      "defining-doc subtree), `node_count` + `node_types` (a type histogram — use it to pick a `type` filter), " +
      "`responsibilities`, and Active Data it controls. Prime Agents have 2000+ nodes — page and narrow by type.",
    shape: {
      name: z.string().describe("Entity slug OR natural-language name (e.g. 'spark', 'Spark Protocol', 'grove foundation')."),
      type: z.string().optional().describe("Restrict `nodes` to one atlas doc type (see `node_types` in the response)."),
      limit: z.number().int().min(1).max(200).default(50).describe("Max nodes per page."),
      offset: z.number().int().min(0).default(0).describe("Node pagination offset; use with `has_more`."),
      include_content: z.boolean().default(false).describe("Include full node content (heavier). Default false = slim rows."),
    },
    handler: (ix, a) =>
      atlasEntity(ix, a.name as string, {
        type: a.type as string | undefined,
        limit: (a.limit as number | undefined) ?? 50,
        offset: (a.offset as number | undefined) ?? 0,
        include_content: (a.include_content as boolean | undefined) ?? false,
      }),
  },
  {
    name: "atlas_filter",
    whenToUse:
      "You need a COMPLETE class listing — every doc with an exact title, a title prefix, a type, a doc_no pattern, an entity subtree, or a depth range. Ranked search is not a census.",
    annotations: readOnlyAtlasTool("Atlas Filter"),
    description:
      "Filter Atlas documents by structural attributes (not ranked search). Compose any of: title (exact, case-sensitive), title_prefix, type, entity slug (restricts to entity's artifact subtree), ancestor_id (recursive descendants), doc_no_pattern (SQL LIKE, e.g. '%.0.4.%'), depth_min/max. Collects every match, sorts by doc_no, then pages. Returns `{ total, count, offset, has_more, truncated?, results }`; `total` is the match count before paging.",
    shape: {
      type: z.string().optional().describe("Atlas doc type (e.g. 'Active Data', 'Core', 'Action Tenet')."),
      entity: z.string().optional().describe("Entity slug — restricts to the entity's defining_doc subtree."),
      ancestor_id: z.string().optional().describe("UUID or doc_no — restricts to recursive descendants."),
      doc_no_pattern: z.string().optional().describe("LIKE pattern over doc_no (use % wildcards)."),
      title: z.string().optional().describe("Exact document title, case-sensitive (e.g. 'Rate Limit')."),
      title_prefix: z.string().optional().describe("Title prefix (e.g. 'Rate Limit' also matches 'Rate Limits')."),
      depth_min: z.number().int().min(0).max(20).optional(),
      depth_max: z.number().int().min(0).max(20).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      include_content: z.boolean().default(false).describe("Include full content. Default false for slim listing rows."),
    },
    // depth_min/depth_max are optional integers with no default, so a model
    // that fills every property has no way to say "no depth range" — it
    // invents one, and every document outside it silently stops matching on a
    // tool whose whole job is a COMPLETE class listing.
    emptyArgsAbsent: true,
    handler: (ix, a) => atlasFilter(ix, a as Parameters<typeof atlasFilter>[1]),
  },
  {
    name: "atlas_entity_params",
    whenToUse:
      "You need an instance's actual PARAMETER VALUES — rates, thresholds, statuses, signer counts, addresses — as a map. Read configured values here rather than inferring them from prose or a doc title.",
    annotations: readOnlyAtlasTool("Atlas Entity Params"),
    description:
      "Return the immediate Core children of a doc as a parameter map. Useful for any ICD whose params are encoded " +
      "as child Cores. With `id`, returns that one doc's params. With `entity`, returns params for every INSTANCE doc " +
      "under the entity (not the whole subtree); the response also lists `available_subtypes` so you can refine.",
    shape: {
      id: z.string().optional().describe("Doc UUID or doc_no (typically an instance doc)."),
      entity: z.string().optional().describe("Entity slug — fetch params for all instance docs under entity."),
      type_hint: z
        .string()
        .optional()
        .describe(
          "Filter instance docs by their SUBTYPE, case-insensitive substring (e.g. 'reward' matches " +
            "'distribution-reward' and 'core-governance-reward'). Only applies with `entity`; see `available_subtypes`.",
        ),
      limit: z.number().int().min(1).max(200).default(50),
    },
    handler: (ix, a) => atlasEntityParams(ix, a as Parameters<typeof atlasEntityParams>[1]),
  },
  {
    name: "atlas_params",
    whenToUse:
      "You need a configured governance/instance parameter VALUE by name (rate limit, cap, ratio, threshold, quorum) and don't know which doc holds it. Deterministic table lookup — prefer it over searching prose for numbers.",
    annotations: readOnlyAtlasTool("Atlas Params"),
    description:
      "Deterministic parameter table extracted from doc content at index build time (docs/research/synlang-wiki.md " +
      "§3.1) — name/value/unit/owner rows with source doc UUIDs, for rate limits, ratios, quorums, thresholds, and " +
      "other configured numeric constants. Matches `query` against each row's name + owner + doc_no (every query token " +
      "of 3+ characters must appear somewhere in that combined text). Returns `{ count, truncated?, rows }`; each " +
      "row: `{ uuid, doc_no, name, value, unit, owner, context }`.",
    shape: {
      query: z.string().optional().describe("Search text matched against parameter name, owner, and doc_no (e.g. 'keel maxAmount', 'liquidation ratio')."),
      limit: z.number().int().min(1).max(100).default(25),
      q: z.string().optional().describe("Deprecated alias of `query`."),
    },
    handler: (ix, a) => atlasParams(ix, { query: (a.query as string | undefined) ?? (a.q as string | undefined), limit: (a.limit as number | undefined) ?? 25 }),
  },
];
