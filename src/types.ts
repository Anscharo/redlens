export interface AtlasNode {
  id: string;
  doc_no: string;
  title: string;
  type: string;
  depth: number;
  parentId: string | null;
  content: string;
  order: number; // parse order, used for sorting within a scope
  addresses: Record<string, { chain: string; explorerUrl: string }>;
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
