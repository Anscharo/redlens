// What the relation graph knows about one on-chain address, for the address
// hover card: the multisigs it is (threshold + signers, from build-graph's
// multisig pattern — scripts/lib/graph-multisigs.mjs) and the atlas documents
// that mention it. Pure over GraphData so it is testable without a worker.
import type { GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graphData";
import { parseMetaObject } from "./meta";
import { cmpDocNo } from "./docNo";

export interface MultisigSigner {
  name: string;
  /** Signers this party holds; null when the atlas names the party but no count. */
  count: number | null;
}

export interface MultisigFact {
  name: string;
  /** Every chain the atlas places this same multisig (same threshold and signers) on. */
  chains: string[];
  /** "M/N" split, or null when the atlas states no signing requirement. */
  threshold: { required: number; total: number } | null;
  signers: MultisigSigner[];
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

function signersOf(ms: GraphEntity, signerEdges: RelationEdge[], byId: Map<string, GraphEntity>): MultisigSigner[] {
  return signerEdges
    .filter((e) => e.t === ms.id)
    .map((e) => {
      const count = parseMetaObject(e.m)?.signer_count;
      return { name: byId.get(e.f)?.name ?? e.f, count: typeof count === "number" ? count : null };
    })
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name));
}

function multisigFacts(graph: GraphData): Map<string, MultisigFact[]> {
  const byId = new Map(graph.participants.map((e) => [e.id, e]));
  const signerEdges = graph.edges.filter((e) => e.e === "signer_of");
  const out = new Map<string, MultisigFact[]>();
  for (const ms of graph.participants) {
    if (ms.et !== "multisig") continue;
    const meta = parseMetaObject(ms.m);
    if (typeof meta?.address !== "string") continue;
    const fact: MultisigFact = {
      name: ms.name,
      chains: typeof meta.chain === "string" ? [meta.chain] : [],
      threshold: parseThreshold(meta.threshold),
      signers: signersOf(ms, signerEdges, byId),
      docId: ms.did,
    };
    out.set(meta.address, mergeInto(out.get(meta.address) ?? [], fact));
  }
  return out;
}

const sameSetup = (a: MultisigFact, b: MultisigFact): boolean =>
  JSON.stringify([a.threshold, a.signers]) === JSON.stringify([b.threshold, b.signers]);

// One Safe deployed at the same address on several chains is documented once
// per chain; the card shows it once, with every chain, when the setup matches.
function mergeInto(list: MultisigFact[], fact: MultisigFact): MultisigFact[] {
  const twin = list.find((f) => sameSetup(f, fact));
  if (!twin) return [...list, fact];
  twin.chains = [...new Set([...twin.chains, ...fact.chains])];
  return list;
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
