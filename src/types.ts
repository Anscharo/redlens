export interface AtlasNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  content: string;
  order: number; // parse order, used for sorting within a scope
  addresses: Record<string, AddressInfo>;
}

export interface AddressInfo {
  chain: string;
  explorerUrl: string;
  roles: string[];          // multi-label tags from build-index.mjs ROLE_VOCAB
  entityLabel: string | null;
  aliases: string[];        // other labels found for this address across the Atlas
  expectedTokens: string[]; // text-derived guess at which ERC20s to query
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
}

// Worker message types
export type WorkerInMessage =
  | { type: "query"; id: number; q: string }
  | { type: "ping" };

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "results"; id: number; hits: SearchHit[]; durationMs: number }
  | { type: "error"; id: number; message: string };
