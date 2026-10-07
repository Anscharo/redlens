// Who is calling a tool, for the few handlers whose answer depends on it (the
// preview tools: MCP is anonymous and read-only, chat may build and may reach a
// private repo its signed-in user is a collaborator on). Every other handler
// ignores it. A missing context is the anonymous MCP caller, so least privilege
// is the default for any call site that does not pass one.

import type { LargeRead } from "../large-read.ts";

export interface ToolCallContext {
  surface: "chat" | "mcp";
  /** users.id of the signed-in chat user. Never set on MCP. */
  userId?: string;
  /** Bounds how long a handler waits (a preview build); chat passes the request's. */
  signal?: AbortSignal;
  /** Chat only. A handler awaits this before returning private-repo content, and
   *  a throw means the content must not be returned. Absent ⇒ no private content. */
  onPrivateAccess?: (repo: string) => Promise<void>;
  /** Chat only: the turn's large-read allowance (chat/large-read.ts). Absent ⇒ ordinary budget. */
  largeRead?: LargeRead | null;
}

export const ANON_MCP_CTX: ToolCallContext = Object.freeze({ surface: "mcp" });
