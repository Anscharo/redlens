// Entity → on-chain addresses, one hop out.
//
// Addresses hang off the entity that HOLDS them (`has_address`, entity→address),
// so an agent's own edges expose only the agent's own address: the addresses of
// the multisigs it signs and the instances it runs are one hop further. A
// measured chat turn ("what are all addresses related to Grove?") stopped at
// that boundary and answered with three multisig names and no addresses, so
// atlas_entity now resolves the hop itself.
//
// Both edge directions are walked, deliberately: `signer_of` runs agent→multisig
// (outbound) while `invoked_by` runs instance→agent (inbound), and an
// outbound-only walk silently drops every instance address.
import type { Indexes, Edge } from "../../retrieval/indexes.ts";
import { fitToBudget } from "../output-budget.ts";

export interface AddressRef {
  address: string;
  chain: string;
}
export interface AddressGroup {
  owner: string; // entity slug that holds these addresses
  owner_name: string;
  entity_type: string;
  // How the owner relates to the queried entity: "self", or the edge type plus
  // the direction it runs relative to the entity ("signer_of" out, "invoked_by" in).
  via: string;
  direction: "self" | "out" | "in";
  addresses: AddressRef[];
  source_doc_nos: string[]; // provenance of the has_address edges
}
export interface EntityAddresses {
  count: number; // addresses found, before any truncation
  groups: AddressGroup[];
  truncated?: true;
}

// Address graph nodes are keyed `<address>:<chain>`. Solana base58 carries no
// colon of its own, so the LAST colon is always the chain separator.
function splitAddressNode(id: string): AddressRef {
  const i = id.lastIndexOf(":");
  return i === -1 ? { address: id, chain: "" } : { address: id.slice(0, i), chain: id.slice(i + 1) };
}

function parseDocNos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

// A dedicated slice of the caller's budget (MAX_RESULT_CHARS is 200k): the
// address block must never crowd out the documents, but it must fit the worst
// real case whole — the two densest Prime Agents carry 88 and 109 addresses
// (~26k and ~32k chars), and truncating those is exactly the question this
// block exists to answer.
const ADDRESS_BUDGET = 40_000;

export function entityAddresses(ix: Indexes, entityId: string): EntityAddresses {
  // One pass: address edges by holder, plus how each neighbouring entity is
  // linked to this one (first edge wins — the relationship, not every parallel).
  const addrEdges = new Map<string, Edge[]>();
  const linkedVia = new Map<string, { via: string; direction: "out" | "in" }>();
  for (const e of ix.edges) {
    if (e.to_type === "address" && e.from_type === "entity") {
      const arr = addrEdges.get(e.from_id);
      if (arr) arr.push(e);
      else addrEdges.set(e.from_id, [e]);
      continue;
    }
    if (e.from_type !== "entity" || e.to_type !== "entity") continue;
    if (e.from_id === entityId && !linkedVia.has(e.to_id)) linkedVia.set(e.to_id, { via: e.edge_type, direction: "out" });
    else if (e.to_id === entityId && !linkedVia.has(e.from_id)) linkedVia.set(e.from_id, { via: e.edge_type, direction: "in" });
  }
  linkedVia.delete(entityId); // a self-edge is not a hop

  const group = (ownerId: string, via: string, direction: AddressGroup["direction"]): AddressGroup | null => {
    const edges = addrEdges.get(ownerId);
    const owner = ix.entityById.get(ownerId);
    if (!edges || edges.length === 0 || !owner) return null;
    return {
      owner: owner.slug,
      owner_name: owner.name,
      entity_type: owner.entity_type,
      via,
      direction,
      addresses: edges.map((e) => splitAddressNode(e.to_id)),
      source_doc_nos: [...new Set(edges.flatMap((e) => parseDocNos(e.source_doc_nos)))],
    };
  };

  const groups: AddressGroup[] = [];
  const own = group(entityId, "self", "self");
  if (own) groups.push(own);
  for (const [ownerId, link] of linkedVia) {
    const g = group(ownerId, link.via, link.direction);
    if (g) groups.push(g);
  }
  groups.sort((a, b) => (a.direction === "self" ? -1 : b.direction === "self" ? 1 : a.owner.localeCompare(b.owner)));

  const count = groups.reduce((n, g) => n + g.addresses.length, 0);
  const { kept, truncated } = fitToBudget(groups, ADDRESS_BUDGET);
  return { count, groups: kept, ...(truncated ? { truncated: true as const } : {}) };
}
