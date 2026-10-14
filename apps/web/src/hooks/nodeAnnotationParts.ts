// The pure derivations behind a node's annotations, one per category of what the
// reader's right panel and rows show for a document; useNodeAnnotations.ts
// memoises each behind its own hook.
import { byDocNo } from "@/lib/docNo";
import { extractLinkedIds, type LoadedData } from "@/lib/atlasHelpers";
import { chainlogNamedAddresses } from "@/lib/onchainAddressesIndex";
import { docValueSources } from "@/lib/pauDocSources";
import { type AddressInfo, type AtlasNode } from "@/types";
import type { ChainValue } from "../lib/chainstate";
import type { GraphData } from "../lib/graph";

/** The documents the target links to, in document order. */
export const linkedNodesOf = (target: AtlasNode, docs: Record<string, AtlasNode>): AtlasNode[] =>
  extractLinkedIds(target)
    .map((id) => docs[id])
    .filter((n): n is AtlasNode => !!n)
    .sort(byDocNo);

/**
 * Element Annotations attached to the document, read off byParent, which the
 * atlas worker keys by parent UUID after resolving `.0.3.N` via doc_no
 * (`<target>.0.3.N` → target's id), so byParent.get(id) is right even for the
 * annotations the parser's depth-6 heading cap reparents onto a shallower
 * ancestor. Looking up the target's doc_no would miss them. They are hard to
 * find in the reader, because the atlas emits the supporting `0` directory
 * after every real sibling, which is why they get a panel section of their own.
 */
export const annotationDocsOf = (id: string, byParent: Map<string | null, AtlasNode[]>): AtlasNode[] =>
  (byParent.get(id) ?? []).filter((n) => n.type === "Annotation").sort(byDocNo);

export interface DocAddresses {
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  /** Addresses named only by their CHAIN_LOG key (MCD_VAT), not a 0x literal, so the card can flag how the section referenced them. */
  byNameOnly: Set<string>;
}

/** The addresses the target names, by 0x literal and by chainlog key (matching how the On-Chain Addresses report attributes a doc to an address), with their live values. */
export function addressesOf(target: AtlasNode, data: Pick<LoadedData, "addresses" | "chainState">): DocAddresses {
  const out: DocAddresses = { targetAddresses: {}, chainValues: {}, byNameOnly: new Set() };
  const add = (ref: string) => {
    const info = data.addresses?.[ref];
    if (info) out.targetAddresses[ref] = info;
    const val = data.chainState?.values[ref];
    if (val) out.chainValues[ref] = val;
    return !!info;
  };
  for (const ref of target.addressRefs ?? []) add(ref);
  for (const addr of chainlogNamedAddresses(target.content, data.addresses ?? {})) {
    if (out.targetAddresses[addr]) continue; // already referenced by 0x literal
    if (add(addr)) out.byNameOnly.add(addr);
  }
  return out;
}

/** The rate-limit values the document, or the Rate Limits heading it is, shows beside the chain. */
export const rateLimitSourcesOf = (id: string, target: AtlasNode, atlas: LoadedData["atlas"], graph: GraphData | null) =>
  docValueSources(id, graph, { title: target.title, children: (atlas.byParent.get(id) ?? []).map((n) => n.id) }, atlas);
