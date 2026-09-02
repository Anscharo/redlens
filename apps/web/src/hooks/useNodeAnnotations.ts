import { useMemo } from "react";
import { buildLookup, type GlossaryEntry } from "../lib/glossary";
import { extractLinkedIds, type LoadedData } from "@/lib/atlasHelpers";
import { type AtlasNode, type AddressInfo } from "@/types";
import { type ChainValue } from "../lib/chainstate";
import { findCousinDocs, type CousinDoc } from "../lib/cousins";
import type { GraphData } from "../lib/graph";

export function useNodeAnnotations(id: string, data: LoadedData | null, graph: GraphData | null) {
  const glossaryLookup = useMemo(
    () => (data?.glossary ? buildLookup(data.glossary) : {}),
    [data],
  );

  return useMemo(() => {
    const empty = {
      linkedNodes: [] as AtlasNode[],
      targetAddresses: {} as Record<string, AddressInfo>,
      chainValues: {} as Record<string, Record<string, ChainValue>>,
      glossaryTerms: [] as GlossaryEntry[][],
      cousinDocs: [] as CousinDoc[],
      annotationDocs: [] as AtlasNode[],
    };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id] ?? null;
    if (!target) return empty;
    const linkedNodes = extractLinkedIds(target)
      .map((lid) => docs[lid])
      .filter((n): n is AtlasNode => !!n)
      .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));
    const cousinDocs = graph ? findCousinDocs(id, data.atlas, graph) : [];
    // Element Annotations attached to this doc. Read off byParent, which the
    // atlas worker keys by parent UUID after resolving `.0.3.N` via doc_no
    // (`<target>.0.3.N` → target's id) — so byParent.get(id) is right even for
    // the annotations the parser's depth-6 heading cap reparents onto a
    // shallower ancestor. Looking up the target's doc_no would miss them.
    // They are hard to find in the reader — the atlas emits the supporting `0`
    // directory after every real sibling — which is why they get a panel
    // section of their own.
    const annotationDocs = (data.atlas.byParent.get(id) ?? [])
      .filter((n) => n.type === "Annotation")
      .sort((a, b) => a.doc_no.localeCompare(b.doc_no, undefined, { numeric: true }));
    const targetAddresses: Record<string, AddressInfo> = {};
    const cv: Record<string, Record<string, ChainValue>> = {};
    for (const ref of target.addressRefs ?? []) {
      const info = data.addresses?.[ref];
      if (info) targetAddresses[ref] = info;
      const val = data.chainState?.values[ref];
      if (val) cv[ref] = val;
    }
    const contentLower = target.content.toLowerCase();
    const seen = new Set<GlossaryEntry[]>();
    const glossaryTerms: GlossaryEntry[][] = [];
    for (const entries of Object.values(glossaryLookup)) {
      if (!seen.has(entries) && entries.some((e) => contentLower.includes(e.term.toLowerCase()))) {
        seen.add(entries);
        glossaryTerms.push(entries);
      }
    }
    glossaryTerms.sort((a, b) => a[0].term.localeCompare(b[0].term));
    return { linkedNodes, targetAddresses, chainValues: cv, glossaryTerms, cousinDocs, annotationDocs };
  }, [data, id, glossaryLookup, graph]);
}
