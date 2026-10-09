// Names for rate-limit keys, by controller generation. A monolithic key is
// derived from the LIMIT_* constants of the monolithic controllers
// (key-derive.ts). A diamond's facets run their own code, so a diamond key is
// derived only from the shapes the facets it integrates prove (facet-source.ts,
// read from the Controller's replayed IntegrationSet), never from the
// monolithic constants and never from a facet the diamond does not run. Their
// arguments come from the candidate addresses, the diamond's own parameter
// events, and what the facet itself reads on chain (facet-keys.ts HOOKS).
import chainRegistry from "../../data/chain-registry.json";
import type { PauParam, PauSnapshot } from "../../lib/pau.ts";
import { candidateAddresses, keyDeriver, limitConstants, shapeDeriver, type KeyShape } from "./key-derive.ts";
import { facetShapesAt, type FacetShape } from "./facet-source.ts";
import { facetKeyRule, HOOKS, type FacetHook } from "./facet-keys.ts";
import { withDerivedKeys, type ChainReader } from "./snapshot.ts";

/** Adds what can be named to a snapshot's rate-limit keys. */
export type KeyNamer = (snap: PauSnapshot, read: ChainReader) => Promise<PauSnapshot>;

/** Role → address, for one subject a hook read. */
type Bound = Record<string, string>;

const ADDRESS_RE = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
const params = (snap: PauSnapshot): PauParam[] => snap.contracts.flatMap((c) => c.params ?? []);

/** The facets a diamond's Controller integrates now, by their IntegrationSet config. */
export function integratedFacets(snap: PauSnapshot): string[] {
  const facets = snap.contracts.flatMap((c) => c.integrations ?? []).map((i) => (i.config as { facet?: unknown } | null)?.facet);
  return [...new Set(facets.filter((f): f is string => typeof f === "string").map((f) => f.toLowerCase()))];
}

/** One hook's subjects, each with the values the facet reads from it; a failed read leaves its role out. */
async function hookBound(snap: PauSnapshot, read: ChainReader, h: FacetHook): Promise<Bound[]> {
  const subjects = [...new Set(params(snap).filter((p) => p.event === h.event).map((p) => String(p.args[h.arg] ?? "").toLowerCase()))].filter((a) => /^0x[0-9a-f]{40}$/.test(a));
  const res = await read(snap.chain, subjects.flatMap((address) => h.reads.map((r) => ({ address, functionName: r.fn, args: [] }))));
  return subjects.map((s, i) => {
    const got = h.reads.flatMap((r, j) => (typeof res[i * h.reads.length + j] === "string" ? [[r.role, (res[i * h.reads.length + j] as string).toLowerCase()]] : []));
    return Object.fromEntries([[h.role, s], ...got]);
  });
}

function keyShape(s: FacetShape, bound: Bound[]): KeyShape {
  const via = facetKeyRule(s)?.via;
  const tuples = s.roles.length ? bound.filter((b) => s.roles.every((r) => b[r])).map((b) => s.roles.map((r) => b[r])) : [];
  const name = (args: string[]) => ({ constant: s.constant, args, roles: s.roles, facet: s.facet, getter: s.getter, ...(via ? { via: args[s.roles.indexOf(via)] } : {}) });
  return { constant: s.constant, types: s.types, tuples, name };
}

export interface DiamondSources {
  addresses: string[];
  /** The key shapes of the facet at an address on a chain; none when its source is not cached. */
  shapesOf: (chain: string, facet: string) => FacetShape[];
}

/** A diamond snapshot with each key a facet it integrates derives named. */
export async function withDiamondKeys(snap: PauSnapshot, read: ChainReader, src: DiamondSources): Promise<PauSnapshot> {
  const shapes = integratedFacets(snap).flatMap((f) => src.shapesOf(snap.chain, f));
  if (!shapes.length) return snap;
  const bound = new Map<string, Bound[]>();
  for (const h of HOOKS.filter((x) => shapes.some((s) => s.facet === x.facet))) bound.set(h.facet, [...(bound.get(h.facet) ?? []), ...(await hookBound(snap, read, h))]);
  const own = JSON.stringify(params(snap)).match(ADDRESS_RE) ?? [];
  return withDerivedKeys(snap, shapeDeriver(shapes.map((s) => keyShape(s, bound.get(s.facet) ?? [])), [...src.addresses, ...own]));
}

const CHAIN_ID = new Map(chainRegistry.chains.map((c) => [c.chain, c.chainId]));

/**
 * The worker's namer: each generation's deriver, over the address artifacts
 * and the registry's addresses, with the facet sources and monolithic ABIs
 * cached in `dir`. The candidates and the monolithic table are built once.
 */
export function keyNamer(addressFiles: string[], extra: unknown, dir = ".cache/etherscan"): KeyNamer {
  let addresses: string[] | undefined;
  let mono: ReturnType<typeof keyDeriver> | undefined;
  const all = () => (addresses ??= candidateAddresses(addressFiles, extra));
  const shapesOf = (chain: string, facet: string) => (CHAIN_ID.has(chain) ? facetShapesAt(dir, CHAIN_ID.get(chain)!, facet) : []);
  return async (snap, read) =>
    snap.kind === "diamond" ? withDiamondKeys(snap, read, { addresses: all(), shapesOf }) : withDerivedKeys(snap, (mono ??= keyDeriver(limitConstants(dir), all())));
}
