// The chain a key's naming document belongs to, for the Radar PAUs tables: a
// document under a chain heading ("Arbitrum" > "Aggregate CCTP Rate Limit ID")
// names its key for that chain's deployments, so another chain's table shows
// the key's name but must not link into it. The tree is walked by parent
// edges, never by doc_no. Pure.
import type { AtlasKeyRef } from "./pauView.ts";
import { chainOfLabel } from "./pauInstanceChain.ts";
import { ancestorsOf, type LimitDocs } from "./pauLimitDocs.ts";

/** The index with each ref's `chain` set to the chain heading above its document, when one is. */
export function withRefChains(index: Map<string, AtlasKeyRef[]>, docs: LimitDocs | null): Map<string, AtlasKeyRef[]> {
  if (!docs) return index;
  const chainOf = (docId: string) => ancestorsOf(docId, docs).map((a) => chainOfLabel(a.title)).find((c) => c !== null);
  return new Map([...index].map(([key, refs]) => [key, refs.map((r) => {
    const chain = r.docId ? chainOf(r.docId) : undefined;
    return chain ? { ...r, chain } : r;
  })]));
}

/** The refs that apply on `chain`: those under no chain heading, or under that chain's. */
export const refsOnChain = (refs: AtlasKeyRef[], chain: string) => refs.filter((r) => !r.chain || r.chain === chain);
