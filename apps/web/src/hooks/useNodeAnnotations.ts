import { useMemo } from "react";
import { buildLookup, type GlossaryEntry } from "../lib/glossary";
import type { LoadedData } from "@/lib/atlasHelpers";
import { type AtlasNode } from "@/types";
import { findCousinDocs } from "../lib/cousins";
import type { GraphData } from "../lib/graph";
import { addressesOf, annotationDocsOf, linkedNodesOf, rateLimitSourcesOf, type DocAddresses } from "./nodeAnnotationParts";

/** The glossary entries whose term the content uses, each entry set once, sorted by term. */
function glossaryTermsIn(content: string, lookup: Record<string, GlossaryEntry[]>): GlossaryEntry[][] {
  const contentLower = content.toLowerCase();
  const seen = new Set<GlossaryEntry[]>();
  const terms: GlossaryEntry[][] = [];
  for (const entries of Object.values(lookup)) {
    if (!seen.has(entries) && entries.some((e) => contentLower.includes(e.term.toLowerCase()))) {
      seen.add(entries);
      terms.push(entries);
    }
  }
  return terms.sort((a, b) => a[0].term.localeCompare(b[0].term));
}

const NO_ADDRESSES: DocAddresses = { targetAddresses: {}, chainValues: {}, byNameOnly: new Set() };

/** Documents the target links to, its cousins in the graph, and its Element Annotations. */
function useDocLinks(id: string, target: AtlasNode | null, data: LoadedData | null, graph: GraphData | null) {
  return useMemo(() => {
    if (!data || !target) return { linkedNodes: [] as AtlasNode[], cousinDocs: [], annotationDocs: [] as AtlasNode[] };
    return {
      linkedNodes: linkedNodesOf(target, data.atlas.docs),
      cousinDocs: graph ? findCousinDocs(id, data.atlas, graph) : [],
      annotationDocs: annotationDocsOf(id, data.atlas.byParent),
    };
  }, [id, target, data, graph]);
}

/** The glossary terms the target's text uses. */
function useGlossaryTerms(target: AtlasNode | null, data: LoadedData | null) {
  const lookup = useMemo(() => (data?.glossary ? buildLookup(data.glossary) : {}), [data]);
  return useMemo(() => (target ? glossaryTermsIn(target.content, lookup) : []), [target, lookup]);
}

/** One node's annotations for the reader's rows and right panel, each category derived by its own hook. */
export function useNodeAnnotations(id: string, data: LoadedData | null, graph: GraphData | null) {
  const target = useMemo(() => (data && id ? (data.atlas.docs[id] ?? null) : null), [data, id]);
  const links = useDocLinks(id, target, data, graph);
  const glossaryTerms = useGlossaryTerms(target, data);
  const addresses = useMemo(() => (data && target ? addressesOf(target, data) : NO_ADDRESSES), [data, target]);
  const rateLimitSources = useMemo(() => (data && target ? rateLimitSourcesOf(id, target, data.atlas, graph) : null), [id, target, data, graph]);
  return useMemo(
    () => ({ ...links, glossaryTerms, targetAddresses: addresses.targetAddresses, chainValues: addresses.chainValues, byNameOnly: addresses.byNameOnly, rateLimitSources }),
    [links, glossaryTerms, addresses, rateLimitSources],
  );
}
