import type { GraphEntity, RelationEdge } from "../types";
import type { GraphData } from "./graph";

export const ENTITY_TYPE_LABEL: Record<string, string> = {
  agent: "Agent",
  facilitator_org: "Facilitator",
  govops_org: "GovOps",
  delegate_org: "Aligned Delegate",
  development_company: "Dev Company",
  foundation: "Foundation",
  composite_party: "Composite Party",
  governance_body: "Governance Body",
  operational_party: "Operational Party",
  ecosystem_actor: "Ecosystem Actor",
  instance: "Instance",
  multisig: "Multisig",
  bridge: "Bridge",
};

export const SUBTYPE_LABEL: Record<string, string> = {
  prime: "Prime",
  executor: "Executor",
  aligned_delegate: "Aligned Delegate",
  operational: "Operational",
  core: "Core",
  individual: "Individual",
  integration_partner: "Integration Partner",
  bridge_validator: "Bridge Validator",
};

/** Labels vary by the edge's direction relative to the viewer.
 *  `forward` reads "**src** *verb* **tgt**"; `reverse` reads "**tgt** *verb* **src**". */
const EDGE_TYPE_LABELS: Record<string, { forward: string; reverse: string }> = {
  // entity ↔ entity
  prime_agent_for: { forward: "prime agent for", reverse: "has prime agent" },
  operational_executor_agent_for: {
    forward: "operational executor agent for",
    reverse: "has operational executor agent",
  },
  core_executor_agent_for: {
    forward: "core executor agent for",
    reverse: "has core executor agent",
  },
  operational_facilitator_for: {
    forward: "operational facilitator for",
    reverse: "has operational facilitator",
  },
  core_facilitator_for: { forward: "core facilitator for", reverse: "has core facilitator" },
  operational_govops_for: { forward: "operational govops for", reverse: "has operational govops" },
  core_govops_for: { forward: "core govops for", reverse: "has core govops" },
  aligned_delegate_for: { forward: "aligned delegate for", reverse: "has aligned delegate" },
  ranked_delegate_for: { forward: "ranked delegate for", reverse: "has ranked delegate" },
  holds_role_for: { forward: "holds role for", reverse: "has role-holder" },
  comprises: { forward: "comprises", reverse: "part of" },
  signer_of: { forward: "signer of", reverse: "has signer" },
  can_modify_signers_of: { forward: "can modify signers of", reverse: "signers modifiable by" },
  validator_of: { forward: "validator of", reverse: "has validator" },
  funds_transfer: { forward: "transferred funds to", reverse: "received funds from" },
  authorized_rep_for: { forward: "authorized rep for", reverse: "has authorized rep" },
  integration_partner_of: { forward: "integration partner of", reverse: "has integration partner" },
  prime_foundation_of: { forward: "prime foundation of", reverse: "has prime foundation" },
  provides_services_to: { forward: "provides services to", reverse: "served by" },
  // doc ↔ entity
  ecosystem_accord: { forward: "binds", reverse: "party to" },
  defines_entity: { forward: "defines", reverse: "defined by" },
  erg_member_for: { forward: "ERG member of", reverse: "has ERG member" },
  responsible_party_for: { forward: "responsible party for", reverse: "has responsible party" },
  governance_channel: { forward: "governance channel for", reverse: "has governance channel" },
  emergency_response: { forward: "emergency response for", reverse: "has emergency response" },
  // address edges
  has_address: { forward: "has address", reverse: "owned by" },
  mentions: { forward: "mentions", reverse: "mentioned in" },
  proxies_to: { forward: "proxies to", reverse: "implementation of" },
  // doc ↔ doc
  parent_of: { forward: "parent of", reverse: "child of" },
  annotates: { forward: "annotates", reverse: "annotated by" },
  active_data_for: { forward: "active data for", reverse: "has active data" },
  cites: { forward: "cites", reverse: "cited by" },
  implements: { forward: "implements", reverse: "implemented by" },
  instance_of: { forward: "instance of", reverse: "has instance" },
  invoked_by: { forward: "invoked by", reverse: "invoked" },
  located_at: { forward: "located at", reverse: "location of" },
  has_status: { forward: "has status", reverse: "status of" },
};

export function edgeLabel(edgeType: string, direction: "outbound" | "inbound"): string {
  const pair = EDGE_TYPE_LABELS[edgeType];
  if (!pair) return edgeType;
  return direction === "outbound" ? pair.forward : pair.reverse;
}

export const ENTITY_TYPE_COLOR: Record<string, string> = {
  agent: "var(--entity-agent)",
  facilitator_org: "var(--entity-facilitator-org)",
  govops_org: "var(--entity-govops-org)",
  delegate_org: "var(--entity-delegate-org)",
  development_company: "var(--entity-development-company)",
  foundation: "var(--entity-foundation)",
  composite_party: "var(--entity-composite-party)",
  governance_body: "var(--entity-governance-body)",
  operational_party: "var(--entity-operational-party)",
  ecosystem_actor: "var(--entity-ecosystem-actor)",
  instance: "var(--entity-instance)",
  multisig: "var(--entity-multisig)",
  bridge: "var(--entity-bridge)",
};

export interface EntityNodeData {
  id: string;
  label: string;
  entity: GraphEntity;
  color: string;
  degree: number;
  size: number;
}

export interface EntityEdgeData {
  key: string;
  src: string;
  tgt: string;
  type: string;
  sources: string[];
}

export interface EntityRelation {
  edge: RelationEdge;
  direction: "outbound" | "inbound";
  otherId: string;
  otherType: "doc" | "entity" | "address";
  otherLabel: string;
}

/** Visual importance: primes are the focal point, executors are the hubs they report to. */
function nodeSize(ent: GraphEntity, degree: number): number {
  if (ent.et === "agent" && ent.st === "prime") return 14;
  if (ent.et === "agent" && ent.st === "executor") return 10;
  return 4 + Math.min(degree, 8) * 0.8;
}

/** Build the set of entity nodes with computed degree (counts direct entity↔entity edges only). */
export function buildEntityNodes(data: GraphData): EntityNodeData[] {
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    if (e.ft === "entity" && e.tt === "entity") {
      degree.set(e.f, (degree.get(e.f) ?? 0) + 1);
      degree.set(e.t, (degree.get(e.t) ?? 0) + 1);
    }
  }
  return [...data.participants, ...data.instances].map((ent) => {
    const d = degree.get(ent.id) ?? 0;
    return {
      id: ent.id,
      label: ent.name,
      entity: ent,
      color: ENTITY_TYPE_COLOR[ent.et] ?? "var(--entity-fallback)",
      degree: d,
      size: nodeSize(ent, d),
    };
  });
}

/** GraphEntity types that participate in direct entity↔entity edges. */
export const CONNECTED_ENTITY_TYPES: ReadonlySet<string> = new Set([
  "agent",
  "facilitator_org",
  "govops_org",
  "delegate_org",
  "development_company",
  "foundation",
  "composite_party",
  "governance_body",
  "operational_party",
  "ecosystem_actor",
  "instance",
  "multisig",
  "bridge",
]);

/** Entity↔entity edges only, for the ReactFlow graph. */
export function buildEntityEdges(data: GraphData): EntityEdgeData[] {
  const out: EntityEdgeData[] = [];
  let i = 0;
  for (const e of data.edges) {
    if (e.ft !== "entity" || e.tt !== "entity") continue;
    out.push({
      key: `e${i++}`,
      src: e.f,
      tgt: e.t,
      type: e.e,
      sources: e.s ?? [],
    });
  }
  return out;
}

/** Every edge that involves an entity on either end, grouped by direction relative to `entityId`.
 *  Used by the detail panel — includes entity↔doc and entity↔address edges too. */
export function getEntityRelations(
  entityId: string,
  data: GraphData,
  entityById: Map<string, GraphEntity>,
): EntityRelation[] {
  const rels: EntityRelation[] = [];
  for (const e of data.edges) {
    if (e.f === entityId) {
      rels.push({
        edge: e,
        direction: "outbound",
        otherId: e.t,
        otherType: e.tt as EntityRelation["otherType"],
        otherLabel: labelFor(e.t, e.tt, entityById),
      });
    } else if (e.t === entityId) {
      rels.push({
        edge: e,
        direction: "inbound",
        otherId: e.f,
        otherType: e.ft as EntityRelation["otherType"],
        otherLabel: labelFor(e.f, e.ft, entityById),
      });
    }
  }
  return rels;
}

function labelFor(id: string, type: string, entityById: Map<string, GraphEntity>): string {
  if (type === "entity") return entityById.get(id)?.name ?? id.slice(0, 8);
  if (type === "address") return id.startsWith("addr:") ? id.slice(5, 17) + "…" : id.slice(0, 10);
  return id;
}

export function buildEntityIndex(participants: GraphEntity[]): Map<string, GraphEntity> {
  const m = new Map<string, GraphEntity>();
  for (const e of participants) m.set(e.id, e);
  return m;
}
