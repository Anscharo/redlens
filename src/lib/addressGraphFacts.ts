// What the relation graph knows about one on-chain address, for the address
// hover card: the multisigs the atlas says it is (threshold, from build-graph's
// multisig pattern — scripts/lib/graph-multisigs.mjs) and the atlas documents
// that mention it. Pure over GraphData so it is testable without a worker.
import type { GraphData } from "./graphData";
import { parseMetaObject } from "./meta";
import { cmpDocNo } from "./docNo";

export interface MultisigFact {
  name: string;
  chain: string | null;
  /** The atlas's stated "M/N" split, or null when it states no signing requirement. */
  threshold: { required: number; total: number } | null;
  /** The multisig's root atlas document (UUID). */
  docId: string | null;
}

export interface AddressDocRef {
  id: string;
  docNo: string;
}

export interface AddressGraphFacts {
  multisigs: MultisigFact[];
  /** Every document with a `mentions` edge to the address, doc_no order. */
  docs: AddressDocRef[];
}

const THRESHOLD_RE = /^(\d+)\s*\/\s*(\d+)$/;

function parseThreshold(raw: unknown): MultisigFact["threshold"] {
  const m = typeof raw === "string" ? THRESHOLD_RE.exec(raw.trim()) : null;
  return m ? { required: Number(m[1]), total: Number(m[2]) } : null;
}

// Address node ids are `<address>:<chain>`; the address half is lowercased for
// EVM and as-written for case-sensitive Solana keys (address-chains.mjs).
const addressOf = (nodeId: string): string => nodeId.slice(0, nodeId.lastIndexOf(":"));

function multisigFacts(graph: GraphData): Map<string, MultisigFact[]> {
  const out = new Map<string, MultisigFact[]>();
  for (const ms of graph.participants) {
    if (ms.et !== "multisig") continue;
    const meta = parseMetaObject(ms.m);
    if (typeof meta?.address !== "string") continue;
    const chain = typeof meta.chain === "string" ? meta.chain : null;
    const fact = { name: ms.name, chain, threshold: parseThreshold(meta.threshold), docId: ms.did };
    out.set(meta.address, [...(out.get(meta.address) ?? []), fact]);
  }
  return out;
}

function mentioningDocs(graph: GraphData): Map<string, AddressDocRef[]> {
  const out = new Map<string, Map<string, AddressDocRef>>();
  for (const e of graph.edges) {
    if (e.e !== "mentions" || e.tt !== "address" || e.ft !== "doc") continue;
    const addr = addressOf(e.t);
    const docs = out.get(addr) ?? new Map<string, AddressDocRef>();
    docs.set(e.f, { id: e.f, docNo: e.s?.[0] ?? "" });
    out.set(addr, docs);
  }
  return new Map([...out].map(([a, docs]) => [a, [...docs.values()].sort((x, y) => cmpDocNo(x.docNo, y.docNo))]));
}

interface AddressGraphIndex {
  multisigs: Map<string, MultisigFact[]>;
  docs: Map<string, AddressDocRef[]>;
}

const indexes = new WeakMap<GraphData, AddressGraphIndex>();

function indexOf(graph: GraphData): AddressGraphIndex {
  let ix = indexes.get(graph);
  if (!ix) {
    ix = { multisigs: multisigFacts(graph), docs: mentioningDocs(graph) };
    indexes.set(graph, ix);
  }
  return ix;
}

/** The address's multisigs and mentioning docs; exact key first, then lowercased (mixed-case EVM). */
export function addressGraphFacts(graph: GraphData, address: string): AddressGraphFacts {
  const ix = indexOf(graph);
  const pick = <T>(m: Map<string, T[]>): T[] => m.get(address) ?? m.get(address.toLowerCase()) ?? [];
  return { multisigs: pick(ix.multisigs), docs: pick(ix.docs) };
}
