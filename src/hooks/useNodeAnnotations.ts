import { useMemo } from "react";
import { buildLookup, type GlossaryEntry } from "../lib/glossary";
import { extractLinkedIds, type LoadedData } from "../lib/atlasHelpers";
import { type AtlasNode, type AddressInfo } from "../types";
import { type ChainValue } from "../lib/chainstate";

export function useNodeAnnotations(id: string, data: LoadedData | null) {
  const glossaryLookup = useMemo(
    () => (data ? buildLookup(data.glossary) : {}),
    [data],
  );

  return useMemo(() => {
    const empty = {
      linkedNodes: [] as AtlasNode[],
      targetAddresses: {} as Record<string, AddressInfo>,
      chainValues: {} as Record<string, Record<string, ChainValue>>,
      glossaryTerms: [] as GlossaryEntry[][],
    };
    if (!data || !id) return empty;
    const { docs } = data.atlas;
    const target = docs[id] ?? null;
    if (!target) return empty;
    const linkedNodes = extractLinkedIds(target)
      .map((lid) => docs[lid])
      .filter((n): n is AtlasNode => !!n);
    const targetAddresses: Record<string, AddressInfo> = {};
    const cv: Record<string, Record<string, ChainValue>> = {};
    for (const ref of target.addressRefs ?? []) {
      const info = data.addresses[ref];
      if (info) targetAddresses[ref] = info;
      const val = data.chainState.values[ref];
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
    return { linkedNodes, targetAddresses, chainValues: cv, glossaryTerms };
  }, [data, id, glossaryLookup]);
}
