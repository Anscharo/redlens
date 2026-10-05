// Class-level and multi-dimensional tools: first-seen dates over a class of
// documents, and the one-call atlas_query. Assembled into ATLAS_TOOLS by
// tool-registry.ts.
import { z } from "zod";
import { atlasQuery, type QueryArgs } from "../../retrieval/query.ts";
import { atlasQueryShape } from "../../retrieval/query-schema.ts";
import { atlasFirstSeen } from "../../history/first-seen.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";

export const QUERY_TOOLS: AtlasTool[] = [
  {
    name: "atlas_first_seen",
    whenToUse:
      "'Since when' / oldest first-seen for docs — ONLY when the atlas text gives no explicit date. For a named class (oldest Rate Limit), pass title/type/… — do NOT pass ids you got from search. Cite the source as history-derived, never as an atlas-stated date.",
    annotations: readOnlyAtlasTool("Atlas First Seen"),
    description:
      "Since when has this existed? Two exclusive modes. (1) `ids`: bulk lookup of the earliest atlas_history " +
      "'added' date for up to 50 entity slugs and/or doc UUIDs/doc_nos; returns `{ results }`. (2) Class filter " +
      "(`title` / `title_prefix` / `type` / `doc_no_pattern` / `ancestor_id` / `entity`): resolves the whole class " +
      "in process, then one SQL min over atlas_history — no 50 cap. Returns `{ class_total, class_with_history, event, oldest, undated }`. " +
      "`event` is `added` (default, first-seen) or `modified` (earliest non-move content edit). Do not pass ids and a class filter together. " +
      "Every date is derived from atlas_history. `first_seen_source` / `source` names the record: `pr:<number>`, " +
      "`mip` / `genesis-v2` / `html-era` / `severed`, or `commit:<short sha>`.",
    shape: {
      ids: z
        .array(z.string())
        .min(1)
        .max(50)
        .optional()
        .describe("Entity slugs and/or doc UUIDs/doc_nos to look up, up to 50 per call. XOR with class filters."),
      title: z.string().optional().describe("Exact document title, case-sensitive. Class mode."),
      title_prefix: z.string().optional().describe("Title prefix. Class mode."),
      type: z.string().optional().describe("Atlas doc type. Class mode."),
      doc_no_pattern: z.string().optional().describe("LIKE pattern over doc_no. Class mode."),
      ancestor_id: z.string().optional().describe("UUID or doc_no subtree. Class mode."),
      entity: z.string().optional().describe("Entity slug subtree. Class mode."),
      event: z
        .enum(["added", "modified"])
        .optional()
        .describe("Class mode only. `added` (default) = earliest added row; `modified` = earliest content edit."),
    },
    emptyArgsAbsent: true,
    handler: (ix, a) => atlasFirstSeen(ix, a as Parameters<typeof atlasFirstSeen>[1]),
  },
  {
    name: "atlas_query",
    whenToUse:
      "START HERE for most substantive questions. One call combines search + entity-graph + doc-type + history + status + ancestor scope; prefer one rich atlas_query over chaining narrow tools.",
    annotations: readOnlyAtlasTool("Atlas Query"),
    description:
      "One-call multi-dimensional atlas query. Combines any subset of: semantic/lexical search (query), " +
      "entity graph traversal (entity + edge_types), entity-chain traversal (entity + via_entity_type), " +
      "doc-type filter (target_type), history window (since/until/change_type), status filter, " +
      "ancestor scope (ancestor_id), and inline instance params (include_params). All active dimensions " +
      "are intersected. Use instead of chaining atlas_search + atlas_get when the question spans dimensions. " +
      "Lean results by default — see `enrich`.",
    shape: atlasQueryShape,
    emptyArgsAbsent: true,
    handler: (ix, a) => atlasQuery(ix, a as unknown as QueryArgs),
  },
];
