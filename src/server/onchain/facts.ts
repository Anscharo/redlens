// On-chain facts for the chat and MCP tools: values a worker read from the chain
// and stored, never atlas text. Each source turns its stored state into uniform
// facts, and the index finds them by what a fact is about (key hashes,
// addresses, the atlas documents that state or set it), so any tool result that
// names one of those can carry the fact beside it.
import type { Indexes } from "../retrieval/indexes.ts";
import { ONCHAIN_SOURCES } from "./sources.ts";

export interface OnchainFact {
  /** The source that read it ("pau"). */
  source: string;
  /** What it is: "rate-limit", "role", "member". */
  kind: string;
  chain: string;
  /** The atlas entity whose contract it is, by name and id. */
  entity: string;
  entity_id: string;
  contract: string;
  /** What the atlas or a derivation calls it, or null when nothing names it. */
  name: string | null;
  name_source: "atlas" | "derived" | null;
  atlas_doc_id: string | null;
  values: Record<string, unknown>;
  /** The few values a tool shows when it carries the fact beside its own result. */
  summary: Record<string, unknown>;
  set_at: { time: string; tx: string; url: string } | null;
  read_at: string;
  /** Whether the contract's event history was fully read; false means a fact may be missing, not absent. */
  history_complete: boolean;
  /** What the fact can be found by. Internal; tools strip it. */
  match: { hashes: string[]; addresses: string[]; docs: string[] };
}

/** How far a source has read one deployment, so a gap reads as "not read yet" rather than as nothing. */
export interface Coverage {
  source: string;
  entity: string;
  entity_id: string;
  chain: string;
  /** What the source calls the deployment ("monolithic", "diamond"). */
  label: string;
  contracts: number;
  history_complete: boolean;
  read_at: string;
}

export interface OnchainSource {
  id: string;
  /** One sentence on what the source reads, for the tool result. */
  describe: string;
  read(ix: Indexes): Promise<{ facts: OnchainFact[]; coverage: Coverage[] }>;
}

export interface FactIndex {
  facts: OnchainFact[];
  coverage: Coverage[];
  byHash: Map<string, OnchainFact[]>;
  byAddress: Map<string, OnchainFact[]>;
  byDoc: Map<string, OnchainFact[]>;
}

function push(map: Map<string, OnchainFact[]>, key: string, f: OnchainFact) {
  const k = key.toLowerCase();
  map.set(k, [...(map.get(k) ?? []), f]);
}

export function indexFacts(facts: OnchainFact[], coverage: Coverage[] = []): FactIndex {
  const ix: FactIndex = { facts, coverage, byHash: new Map(), byAddress: new Map(), byDoc: new Map() };
  for (const f of facts) {
    for (const h of f.match.hashes) push(ix.byHash, h, f);
    for (const a of f.match.addresses) push(ix.byAddress, a, f);
    for (const d of f.match.docs) push(ix.byDoc, d, f);
  }
  return ix;
}

/** A fact as atlas_onchain returns it: without its match keys or the summary that repeats its values. */
export function factOutput({ match: _m, summary: _s, ...rest }: OnchainFact): Omit<OnchainFact, "match" | "summary"> {
  return rest;
}

const TTL_MS = 60_000;
const cache = new WeakMap<Indexes, { at: number; index: Promise<FactIndex> }>();

/** Every source's facts, indexed; rebuilt a minute after the last build or when the atlas indexes change. A source that fails contributes none. */
export function factIndex(ix: Indexes, now = Date.now()): Promise<FactIndex> {
  const hit = cache.get(ix);
  if (hit && now - hit.at < TTL_MS) return hit.index;
  const empty = { facts: [] as OnchainFact[], coverage: [] as Coverage[] };
  const reads = ONCHAIN_SOURCES.map((s) => s.read(ix).catch(() => empty));
  const index = Promise.all(reads).then((all) => indexFacts(all.flatMap((r) => r.facts), all.flatMap((r) => r.coverage)));
  cache.set(ix, { at: now, index });
  return index;
}
