import { useMemo } from "react";
import { byDocNo } from "@/lib/docNo";
import { buildLookup, type GlossaryEntry } from "../lib/glossary";
import { extractLinkedIds, type LoadedData } from "@/lib/atlasHelpers";
import { type AtlasNode, type AddressInfo } from "@/types";
import { type ChainValue } from "../lib/chainstate";
import { findCousinDocs, type CousinDoc } from "../lib/cousins";
import { chainlogNamedAddresses } from "@/lib/onchainAddressesIndex";
import type { GraphData } from "../lib/graph";
import { docValueSources, type DocValueSources } from "@/lib/pauDocSources";

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
      byNameOnly: new Set<string>(),
      annotationDocs: [] as AtlasNode[],
      rateLimitSources: null as DocValueSources | null,
    };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id] ?? null;
    if (!target) return empty;
    const linkedNodes = extractLinkedIds(target)
      .map((lid) => docs[lid])
      .filter((n): n is AtlasNode => !!n)
      .sort(byDocNo);
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
      .sort(byDocNo);
    const targetAddresses: Record<string, AddressInfo> = {};
    const cv: Record<string, Record<string, ChainValue>> = {};
    // Addresses named only by their CHAIN_LOG key (MCD_VAT), not a 0x literal, so
    // the card can flag how the section referenced them.
    const byNameOnly = new Set<string>();
    const addAddress = (ref: string) => {
      const info = data.addresses?.[ref];
      if (info) targetAddresses[ref] = info;
      const val = data.chainState?.values[ref];
      if (val) cv[ref] = val;
      return !!info;
    };
    for (const ref of target.addressRefs ?? []) addAddress(ref);
    // Also the addresses this section names only by chainlog key — matching how
    // the On-Chain Addresses report attributes a doc to an address.
    for (const addr of chainlogNamedAddresses(target.content, data.addresses ?? {})) {
      if (targetAddresses[addr]) continue; // already referenced by 0x literal
      if (addAddress(addr)) byNameOnly.add(addr);
    }
    const glossaryTerms = glossaryTermsIn(target.content, glossaryLookup);
    const rateLimitSources = docValueSources(id, graph);
    return { linkedNodes, targetAddresses, chainValues: cv, glossaryTerms, cousinDocs, byNameOnly, annotationDocs, rateLimitSources };
  }, [data, id, glossaryLookup, graph]);
}
