import { useMemo } from "react";
import { buildLookup, type GlossaryEntry } from "../lib/glossary";
import { extractLinkedIds, type LoadedData } from "@/lib/atlasHelpers";
import { type AtlasNode, type AddressInfo } from "@/types";
import { type ChainValue } from "../lib/chainstate";
import { findCousinDocs, type CousinDoc } from "../lib/cousins";
import { chainlogNamedAddresses } from "../lib/onchainAddressesIndex";
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
      byNameOnly: new Set<string>(),
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
    return { linkedNodes, targetAddresses, chainValues: cv, glossaryTerms, cousinDocs, byNameOnly };
  }, [data, id, glossaryLookup, graph]);
}
