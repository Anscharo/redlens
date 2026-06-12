// Same-origin API helper. The Bun server mounts the API at the origin ROOT
// (it matches `pathname === "/api/chat"` etc.), so API calls must hit "/api/…"
// regardless of the app's base path — NOT BASE_URL + "api/…". In prod base is
// "/" so the two coincide; on GH-Pages (base "/redlens/") there is no backend
// anyway; in dev, vite proxies "/api" → the Bun server (:3000). Note: this is
// the one place the "prefix everything through BASE_URL" rule does NOT apply,
// because the API isn't an asset served under the deployed base.
export function apiUrl(path: string): string {
  return `/api/${path.replace(/^\/+/, "")}`;
}

// Mirrors the server's ChatEvent union (src/server/chat-loop.ts) plus the
// `meta` and `error` envelope events emitted by the route (src/server/chat.ts).
export type ChatEvent =
  | { type: "meta"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "clear" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; ok: boolean; bytes: number }
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
