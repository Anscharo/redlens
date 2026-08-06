// Same-origin API helper. The Bun server mounts the API at the origin ROOT
// (it matches `pathname === "/api/chat"` etc.), so API calls hit "/api/…".
// The app's base is "/" (Railway serves from the domain root), and in dev vite
// proxies "/api" → the Bun server (:3000).
export function apiUrl(path: string): string {
  return `/api/${path.replace(/^\/+/, "")}`;
}

// Mirrors the server's HarnessEvent union (src/server/chat/chat-orchestrator.ts —
// ChatEvent plus the reliability-harness `status`/`verify_result` events) and
// the `meta`/`error` envelope events emitted by the route (src/server/chat/chat.ts).
export type VerifyOverall = "pass" | "warn" | "fail" | "unverified";

export interface VerifyClaim {
  claim: string;
  status: "supported" | "unsupported" | "contradicted";
}

export type ChatEvent =
  | { type: "meta"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "clear" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; bytes: number; truncated?: boolean; originalBytes?: number }
  // A downloadable file the agent produced via the export_findings tool.
  // `content` is the whole file; the client auto-downloads it and keeps a
  // button to re-download (see useChatStream `export` case).
  | { type: "export"; format: "markdown" | "csv"; filename: string; mime: string; content: string; bytes: number }
  | { type: "status"; stage: "querying" | "reading" | "checking" | "advising" | "revising"; detail?: string }
  | {
      type: "verify_result";
      overall: VerifyOverall;
      confidence: number | null;
      action: "annotate" | "revised" | null;
      claims: VerifyClaim[];
      invalidCitations: string[];
      invalidDocNos: string[];
      docNoMismatches: string[];
      ungroundedQuotes: string[];
      ungroundedAddresses: string[];
    }
  | {
      type: "done";
      content: string;
      usage: { input: number; output: number };
      generationId: string | null;
      toolCalls: ToolCallRecord[];
    }
  | { type: "error"; message: string };

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  bytes: number;
  truncated?: boolean;
  originalBytes?: number;
}

export interface AuthUser {
  id: string;
  name: string | null;
  avatarUrl: string;
  provider: string;
  email: string | null;
}

export interface UsageWindow {
  tokens: number;
  limit: number;
  resetsAt: string; // ISO timestamp
  exceeded: boolean;
  windowMinutes: number;
}

// The shared "commons" dollar pool — one account-wide balance shown to every
// signed-in user (src/server/chat/credits.ts). Omitted from /api/usage when the
// feature is off or the credits API is unreachable.
export interface CommonsPool {
  used: number; // dollars spent account-wide
  total: number; // dollars purchased (pool size)
  remaining: number; // total - used, floored at 0
}
