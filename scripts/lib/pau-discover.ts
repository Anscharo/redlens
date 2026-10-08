/**
 * Atlas-side PAU discovery: turns the address docs under each Prime agent's
 * "ALM Contracts" / "Diamond PAU Contracts" / "Multisigs" sections, and the
 * Allocation System primitive's "Shared Contracts", into observations of
 * (prime, chain, controller generation, role, address). It only proposes;
 * src/data/pau-registry.json stays the curated source of truth.
 *
 * Every signal is structural and read fresh from the atlas, never a stored
 * doc_no:
 *   - the prime is the ancestor whose UUID is a prime entity's defining doc;
 *   - ancestors come from doc_no arithmetic (buildAncestors), because parentId
 *     skips levels past heading depth 6;
 *   - the generation is "diamond" under any section titled "...Diamond...";
 *   - the chain is the nearest title naming a known chain (chainFromLabel,
 *     the same title matcher build-index uses, so "Gnosis Safe" is not the
 *     gnosis chain), falling back to the address's atlas chain. The doc's own placement outranks
 *     addresses.json, which attributes some PAU addresses to the wrong chain
 *     when the same address exists on two chains.
 */
import { buildAncestors } from "../../src/lib/atlasHelpers.ts";
import type { AtlasNode } from "../../src/types.ts";
import type { PauKind, PauRole } from "../../src/lib/pauRegistry.ts";
import { chainFromLabel } from "./address-chains.mjs";

export interface PauObservation {
  /** Prime entity UUID; null for contracts shared by every diamond PAU. */
  prime: string | null;
  chain: string;
  chainFrom: "title" | "address";
  /** null for a prime's governance multisigs, which serve every generation. */
  kind: PauKind | null;
  role: PauRole;
  address: string;
  doc: string;
  docNo: string;
  title: string;
}

export interface DiscoverInput {
  docs: Record<string, AtlasNode>;
  /** Prime entity UUID → name. A prime entity's UUID is its defining doc's UUID. */
  primes: Map<string, string>;
  /** Atlas chain per address (public/addresses.atlas.json). */
  atlasChain: (address: string) => string | undefined;
}

// Ordered: the first match wins, so "ALM Rate Limits" is never read as a
// controller and "ALM Relayer Multisig" never as a proxy.
const ROLE_RULES: [RegExp, PauRole][] = [
  [/\bRelayer\b/i, "relayer"],
  [/\bFreezer\b/i, "freezer"],
  [/\bFacet\b/i, "facet"],
  [/\bAccessControls\b/i, "accessControls"],
  [/\bAdministeredAgent\b/i, "administeredAgent"],
  [/\bBeacon\b/i, "beacon"],
  [/\bBeamState\b/i, "beamState"],
  [/^Configurator$/i, "configurator"],
  [/\bRate ?Limits\b/i, "rateLimits"],
  [/\bALM Proxy\b/i, "almProxy"],
  [/\bController\b(?!['’]s)/i, "controller"],
];

// The section that anchors an address list: a prime's "ALM Contracts" /
// "Diamond PAU Contracts" / "Multisigs", or the primitive's "Shared
// Contracts". Role-hierarchy and instance docs also carry addresses, but mix
// several roles in one doc. Chain and generation are read only from the anchor
// down, so an unrelated ancestor ("Base Elements") never names a chain.
const PRIME_SECTION_RE = /\b(?:ALM|PAU) Contracts\b|\bMultisigs\b/i;
const SHARED_SECTION_RE = /\bShared Contracts\b/i;
const DIAMOND_RE = /\bDiamond\b/i;
/** Chain of a governance multisig no title places: it serves every chain of its prime. */
export const ANY_CHAIN = "*";
const EVM_RE = /^0x[0-9a-f]{40}$/;
// A leaf titled just "Address" names its role in its parent's title.
const BARE_LEAF_RE = /^(?:State )?Address(?:es)?$/i;

export function roleOf(title: string): PauRole | null {
  return ROLE_RULES.find(([re]) => re.test(title))?.[1] ?? null;
}

function chainOf(titles: string[], address: string, input: DiscoverInput) {
  for (const t of [...titles].reverse()) {
    const chain = chainFromLabel(t);
    if (chain) return { chain, chainFrom: "title" as const };
  }
  const chain = input.atlasChain(address);
  return chain ? { chain, chainFrom: "address" as const } : null;
}

/** The anchor section and everything below it, or null when the doc is not in one. */
function anchoredSections(doc: AtlasNode, input: DiscoverInput, docNoToId: Map<string, string>) {
  const ancestors = buildAncestors(input.docs, docNoToId, doc.id);
  const pi = ancestors.findIndex((a) => input.primes.has(a.id));
  const prime = pi >= 0 ? ancestors[pi].id : null;
  const titles = ancestors.map((a) => a.title);
  const anchor = titles.findIndex((t, i) => i > pi && (prime ? PRIME_SECTION_RE : SHARED_SECTION_RE).test(t));
  return anchor < 0 ? null : { prime, sections: titles.slice(anchor) };
}

/** Diamond under a "Diamond" section; a multisig listed outside the ALM sections serves both. */
function kindOf(prime: string | null, role: PauRole, sections: string[]): PauKind | null {
  if (!prime || sections.some((t) => DIAMOND_RE.test(t))) return "diamond";
  const multisig = role === "relayer" || role === "freezer";
  return multisig && !sections.some((t) => /\bALM\b/i.test(t)) ? null : "monolithic";
}

function observeDoc(doc: AtlasNode, input: DiscoverInput, docNoToId: Map<string, string>): PauObservation[] {
  const anchored = anchoredSections(doc, input, docNoToId);
  if (!anchored) return [];
  const { prime, sections } = anchored;
  const role = roleOf(BARE_LEAF_RE.test(doc.title.trim()) ? sections.at(-1) ?? "" : doc.title);
  if (!role || (!prime && role !== "facet" && role !== "beacon")) return [];
  const kind = kindOf(prime, role, sections);
  const out: PauObservation[] = [];
  for (const address of doc.addressRefs.filter((a) => EVM_RE.test(a))) {
    let where = chainOf([...sections, doc.title], address, input);
    if (!where) continue;
    if (kind === null && where.chainFrom === "address") where = { chain: ANY_CHAIN, chainFrom: "address" };
    out.push({ prime, ...where, kind, role, address, doc: doc.id, docNo: doc.doc_no, title: doc.title });
  }
  return out;
}

/** Every PAU observation in the atlas, in doc order. */
export function discoverPau(input: DiscoverInput): PauObservation[] {
  const docNoToId = new Map(Object.values(input.docs).map((d) => [d.doc_no, d.id]));
  return Object.values(input.docs)
    .filter((d) => d.addressRefs?.length)
    .sort((a, b) => a.order - b.order)
    .flatMap((d) => observeDoc(d, input, docNoToId));
}
