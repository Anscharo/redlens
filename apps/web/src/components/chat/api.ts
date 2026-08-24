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

// A wrong stated value for a known atlas parameter (server:
// verify/param-checks.ts). Structured rather than a sentence so the badge can
// link the parameter's document and show the reader-facing `title` instead of
// the terse extracted kv key in `name`.
export interface ParamMismatch {
  stated: string; // the number as the answer wrote it
  actual: string; // our extraction's value, unit-formatted
  name: string; // extracted kv key — machine vocabulary, not for display
  title: string; // containing doc's title — this is what to show
  owner: string | null;
  uuid: string;
  doc_no: string;
}

// docs/chat-system.md §8. "streaming" (default) is today's
// token-by-token render; "staged" suppresses token/clear and renders an honest
// stage progression, revealing the verified answer once in `done`.
export type Delivery = "streaming" | "staged";

// Full stage vocabulary post staged-delivery: the original harness stages plus
// comparing/synthesizing/finalizing, which only ever fire in staged mode.
export type Stage =
  | "recalling"
  | "querying"
  | "reading"
  | "checking"
  | "advising"
  | "revising"
  | "comparing"
  | "synthesizing"
  | "finalizing";

export type ChatEvent =
  | { type: "meta"; conversationId: string; delivery?: Delivery }
  | { type: "token"; text: string }
  | { type: "clear" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; bytes: number; truncated?: boolean; originalBytes?: number }
  // A downloadable file the agent produced via the export_findings tool.
  // `content` is the whole file; the client auto-downloads it and keeps a
  // button to re-download (see useChatStream `export` case).
  | { type: "export"; format: "markdown" | "csv"; filename: string; mime: string; content: string; bytes: number }
  | { type: "status"; stage: Stage; detail?: string }
  // Deterministic knowledge the server injected before the model ran (glossary
  // definitions, entity rows, censuses, app documentation — src/server/facts).
  // One entry per fact that fired, already phrased for the reader.
  | { type: "facts"; facts: { id: string; summary: string }[]; bytes?: number }
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
      // Hard failures too — optional only so an older server that predates
      // them still parses. Absent is treated as empty/false, never as "clean".
      ungroundedCitationValues?: string[];
      paramMismatches?: ParamMismatch[];
      completenessFailures?: string[];
  // The answer hit the output-token cap mid-generation. Not a citation
      // problem, but it forces a `fail` server-side, so the badge has to be
      // able to say so.
      lengthCapped?: boolean;
    }
  | {
      type: "done";
      content: string;
      usage: { input: number; output: number };
      generationId: string | null;
      toolCalls: ToolCallRecord[];
      // True context size of the turn (last llm round's prompt_tokens).
      // Optional so an older server (pre this field) still parses.
      contextTokens?: number | null;
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
