// Document lookup tools: schema, fetch, search, and address lookup.
import { z } from "zod";
import { atlasDescribe, atlasGet, atlasSearch, atlasGetAddress, type SearchArgs } from "./tools.ts";
import { readOnlyAtlasTool, type AtlasTool } from "./tool-types.ts";
import { withOnchain } from "../../onchain/enrich.ts";

export const CORE_TOOLS: AtlasTool[] = [
  {
    name: "atlas_describe",
    whenToUse:
      "You need exact schema vocabulary (a type name, an edge type, or how entity types connect) before building a filter or traversal, corpus size/mass stats (sections: ['stats']), or our cross-cutting censuses — empty registries, unused doc types, duplicated titles (sections: ['censuses']). Not for content.",
    annotations: readOnlyAtlasTool("Atlas Describe"),
    description:
      "Self-describing schema. By default returns doc-type + edge-type + entity-type vocabularies (with counts) and " +
      "doc/entity totals. Heavier sections are opt-in via `sections` (or 'all'): entity_type_graph (how entity " +
      "types connect — traversal chains like facilitator → executor → prime), type_specifications, and stats " +
      "(doc-mass map: scopes + curated chunk groups with subtree weights — answers 'which part of the atlas is " +
      "biggest / how big is X's artifact'), and censuses (our deterministic cross-cutting censuses over the corpus: " +
      "registry liveness, unused doc types, formula docs, prohibition language, cross-scope duplication… — summary " +
      "counts; 'censuses:<slug>' returns one census with its full member list). Use atlas_entities to look up " +
      "individual entities.",
    shape: {
      sections: z
        .array(z.string())
        .optional()
        .describe(
          "Extra sections to include: 'entity_type_graph', 'type_specifications', 'stats', 'censuses', a 'censuses:<slug>' member drill-down, or 'all'. Omit for the default vocab.",
        ),
    },
    handler: (ix, a) => atlasDescribe(ix, a.sections as string[] | undefined),
  },
  {
    name: "atlas_get",
    whenToUse:
      "You already have a UUID or doc_no and need the full document text — typically to read a doc a search surfaced.",
    annotations: readOnlyAtlasTool("Atlas Get"),
    description:
      "Fetch one or many Atlas nodes by UUID or doc_no. Each result includes the full ancestor chain (parent → root). " +
      "Pass a string for one node or an array for bulk.",
    shape: {
      id: z.union([z.string(), z.array(z.string()).min(1).max(50)]).describe("UUID or doc_no, or an array of up to 50."),
    },
    handler: (ix, a) => atlasGet(ix, a.id as string | string[]),
  },
  {
    name: "atlas_search",
    whenToUse:
      "You only need to find docs by words, with no graph/entity/history dimension. If the question spans dimensions, use atlas_query instead.",
    annotations: readOnlyAtlasTool("Atlas Search"),
    description:
      'Search the Sky Atlas. mode="lexical" uses minisearch BM25 (good for exact terms, IDs, addresses). ' +
      'mode="semantic" uses Qwen3 embeddings via pgvector (paraphrase / concept queries). ' +
      'mode="hybrid" (default) merges both via reciprocal rank fusion. Quoted phrases ("...") are ' +
      "post-filtered to require an exact substring match in title or content.",
    shape: {
      query: z.string().describe('Query. Quote phrases for exact-substring match: foo "USDS PSM" bar'),
      k: z.number().int().min(1).max(50).default(10),
      type: z.string().optional().describe("Optional Atlas document type filter."),
      mode: z.enum(["lexical", "semantic", "hybrid"]).default("hybrid"),
    },
    handler: (ix, a) => atlasSearch(ix, a as unknown as SearchArgs),
  },
  {
    name: "atlas_get_address",
    whenToUse:
      "The question contains or is about an on-chain address (0x… / base58) and you need its entity, roles, or chain state.",
    annotations: readOnlyAtlasTool("Atlas Get Address"),
    description:
      "Look up an on-chain address. Returns merged atlas + chain metadata (label, chainlog id, etherscan name, " +
      "roles, aliases, expected tokens, chain_state snapshot), the linked entity, and the doc edges that reference it. " +
      "When the address is a PAU contract, a role holder, or an asset a rate limit is keyed by, `onchain` carries those live values.",
    shape: {
      address: z.string().describe("0x… (EVM) or base58 (Solana)."),
      chain: z.string().optional().describe("Optional chain filter (e.g. 'ethereum', 'solana')."),
    },
    handler: withOnchain((ix, a) => atlasGetAddress(ix, a.address as string, a.chain as string | undefined)),
  },
];
