export interface AtlasNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  content: string;
  order: number; // parse order, used for sorting within a scope
  addressRefs: string[]; // normalized address keys; resolved via loadAddresses()
}

export interface AddressInfo {
  chain: string;
  explorerUrl: string;
  label: string | null;     // resolved by chainlogId > atlas entityLabel > etherscan ContractName
  chainlogId?: string;      // mainnet only
  etherscanName?: string;   // verified contract name
  isContract: boolean;      // false for unverified contracts and EOAs
  isProxy: boolean;
  implementation?: string;  // lowercase address, only when isProxy
  roles: string[];          // multi-label tags from build-index.mjs ROLE_VOCAB
  aliases: string[];        // other labels found for this address (atlas + losing candidates)
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
