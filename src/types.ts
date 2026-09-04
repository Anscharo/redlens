export type ReportId =
  | "of-responsibilities"
  | "gov-ops-responsibilities"
  | "active-data"
  | "rewards"
  | "processes"
  | "stale-dates"
  | "oea-assessment"
  | "risk-rules"
  | "onchain-addresses"
  | "mod-frequency"
  | "crossview";

export interface AtlasNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  content: string;
  // sha256 of the raw markdown slice; server-only (diff/embeddings). Stripped
  // from the browser docs payload — optional here because the reader never reads it.
  contentHash?: string;
  order: number; // parse order, used for sorting within a scope
  addressRefs: string[]; // normalized address keys; resolved via loadAddresses()
}

export interface AddressInfo {
  chain: string;
  // Every chain the atlas places this address on; always contains `chain`.
  // Safes and deterministically-deployed contracts can sit at the same
  // address on several chains — see addressTooltip.ts's multi-chain balance
  // lookup for why this needs to be a list, not just the primary `chain`.
  chains: string[];
  explorerUrl: string;
  // The authoritative name, resolved at load time: chainlogId ?? etherscanName.
  // NEVER entityLabel (heuristic prose — surfaces as owner via resolveOwner).
  // Prefer resolveAddressName()/resolveOwner() (src/lib/addressName) over reading
  // this directly, so the shortAddr fallback and owner split stay consistent.
  label: string | null;
  entityLabel?: string; // atlas-derived heuristic label (owner context, quality-filtered on display)
  chainlogId?: string; // mainnet only
  etherscanName?: string; // verified contract name
  isContract: boolean; // holds executable code (eth_getCode / Solana executable)
  isProxy: boolean;
  implementation?: string; // proxy implementation, or a Solana program's ProgramData account
  // Solana only — from getAccountInfo. Solana has no contract/EOA split, so
  // these carry what isContract can't say: what kind of account it is and which
  // program owns it. See scripts/lib/solana-accounts.mjs.
  accountType?: string; // program | program-account | mint | token-account | token-multisig | wallet | missing
  programOwner?: string; // owning program's pubkey
  programOwnerName?: string; // its friendly name, when known
  roles: string[]; // from addresses.atlas.json (ROLE_VOCAB + ICD-structural)
  aliases: string[]; // non-winning label candidates from both sources
  expectedTokens: string[]; // token symbols from atlas annotation
}

// Provenance clue shown to the left of a search result: which top-level scope,
// which Prime Agent (scope 6), and/or which Instance Configuration Document the
// hit lives under. Computed from the ancestor chain in the search worker.
export interface HitLabel {
  kind: "scope" | "agent" | "icd";
  text: string;
}

export interface SearchHit {
  id: string;
  score: number;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  snippet: string; // highlighted HTML snippet from content
  titleHtml: string; // highlighted HTML title
  matchReason: string; // why this result was included, e.g. "title + content"
  labels?: HitLabel[]; // scope / agent / ICD provenance clues (left gutter)
  chainlogId?: string; // set when result was found via chainlog reverse-lookup
  chainlogAddress?: string; // the resolved address for chainlog matches
}

// Worker message types — search
export type WorkerInMessage =
  | { type: "query"; id: number; q: string }
  | { type: "ping" }
  | { type: "preload"; docs: Record<string, AtlasNode>; addresses: Record<string, AddressInfo> };

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "results"; id: number; hits: SearchHit[]; durationMs: number }
  | { type: "error"; id?: number; message: string }; // no id for init-time failures

// ---------------------------------------------------------------------------
// Graph types (relations.json — compact keys to minimise payload)
// ---------------------------------------------------------------------------

/** Row shape for every entity in relations.json — actors (Prime/Executor Agents,
 *  Facilitators, GovOps orgs, Aligned Delegates, Governance Parties), Instances
 *  (et="instance"), and Primitives (et="primitive"). Discriminated by `et` and
 *  partitioned across GraphData buckets. */
export interface GraphEntity {
  id: string;
  slug: string;
  name: string;
  et: string; // agent | facilitator_org | govops_org | delegate_org | development_company | foundation | composite_party | governance_body | operational_party | ecosystem_actor | instance | primitive | multisig | bridge
  st: string | null; // agent subtypes: prime | operational_executor | core_executor; instance: <primitive-slug>; primitive: <primitive-slug>; ecosystem_actor: individual | integration_partner
  did: string | null; // defining_doc_id — UUID of the Atlas doc that defines this entity
  // meta JSON, non-null only. Shapes verified against public/graph.json
  // 2026-08-21 — et=instance previously read { primitive_doc_no, agent_doc_no },
  // which was wrong in the way that matters most: those are UUIDs, not the
  // editorial doc numbers (see CLAUDE.md on UUID identity).
  //   et=instance:  { agent_doc_id, primitive_category_doc_id, status, params }
  //   et=primitive: { agent_doc_id, primitive_category_doc_id, status }
  //   et=multisig:  { source, address, chain, threshold, threshold_doc_no, purpose_doc_no }
  //   et=bridge:    { source, component, network, quorum, quorum_doc_no }
  m?: string;
}

export interface RelationEdge {
  f: string; // from_id (UUID or "addr:chain")
  ft: string; // from_type: doc | entity | address
  t: string; // to_id
  tt: string; // to_type: doc | entity | address
  e: string; // edge_type
  s?: string[]; // source_doc_nos — Atlas doc_nos that prove this edge
  m?: string; // meta JSON string, only present when non-null
}

// RelationEdge with worker-resolved labels for entity endpoints
export interface ResolvedEdge extends RelationEdge {
  from_label?: string; // entity name when ft === 'entity'
  from_did?: string;   // entity defining doc UUID when ft === 'entity'
  to_label?: string;   // entity name when tt === 'entity'
  to_did?: string;     // entity defining doc UUID when tt === 'entity'
}

// Serialized subgraph — passed over postMessage to the main thread (and eventually sigma.js)
export interface SerializedSubgraph {
  nodes: Array<{ id: string; attrs: Record<string, unknown> }>;
  edges: Array<{ key: string; src: string; tgt: string; attrs: Record<string, unknown> }>;
}

// Worker message types — graph
export type GraphWorkerInMessage =
  | { type: "ping" }
  | { type: "edges"; id: string }
  | { type: "entity"; slug: string }
  | { type: "neighbors"; id: string; depth?: number }
  | { type: "subgraph"; rootId: string; depth: number };

export type GraphWorkerOutMessage =
  | { type: "ready" }
  | { type: "edges"; id: string; inbound: ResolvedEdge[]; outbound: ResolvedEdge[] }
  | { type: "entity"; slug: string; entity: GraphEntity | null; edges: ResolvedEdge[] }
  | ({ type: "neighbors"; id: string } & SerializedSubgraph)
  | ({ type: "subgraph"; rootId: string } & SerializedSubgraph)
  | { type: "error"; message: string };
