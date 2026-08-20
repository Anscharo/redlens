import { apiUrl, type ToolCallRecord } from "../components/chat/api";

// Typed fetch wrappers for the /api/chat/conversations REST endpoints
// (auth-gated via cookie), mirroring collectionsApi.ts. Backs the
// /conversations list page and the hydrate-on-open flow in ChatWidget.
export interface ConversationSummary {
  id: string;
  // Null until an auto-title lands (turn 1/4/10) or a manual rename sets one.
  title: string | null;
  updatedAt: string;
  messageCount: number;
  // Newest assistant turn's context size (last llm round's prompt_tokens).
  // For legacy conversations with no measured value, the server falls back to
  // an estimate from stored message text and sets contextEstimated — the card
  // renders those with a "~". Null only when the server sent nothing.
  contextTokens: number | null;
  contextEstimated?: boolean;
}

// The wire shape of one persisted message row (GET .../conversations/:id).
// This is the single definition — src/components/chat/hydrate.ts imports it
// from here rather than redeclaring it.
export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  // Present (non-empty) on assistant messages that made tool calls; null on
  // every other row. See src/components/chat/hydrate.ts for how this
  // restores a full ToolTrace on rehydration.
  toolCalls: ToolCallRecord[] | null;
}

export interface ConversationDetail {
  id: string;
  title: string | null;
  updatedAt: string;
  messages: StoredMessage[];
  // MEASURED-only, unlike ConversationSummary's (which falls back to a
  // flagged estimate): null until a live turn records a real prompt size.
  // Deliberate — this seeds the panel's context meter, which must never
  // present an estimate as a near-full warning. So a legacy conversation can
  // show "~12k context" on its list card yet open with an empty meter.
  contextTokens: number | null;
}

// Enforced on the rename input; the server allows up to 120 chars. 48 is the
// UI-facing cap — mirrors MAX_COLLECTION_NAME_LEN's role in collectionsApi.ts.
export const MAX_CONVERSATION_TITLE_LEN = 48;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore — non-JSON error body
    }
    throw new Error(`conversations request failed: ${message}`);
  }
  return res.json() as Promise<T>;
}

export function listConversations(): Promise<ConversationSummary[]> {
  return request<ConversationSummary[]>("chat/conversations");
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return request<ConversationDetail>(`chat/conversations/${id}`);
}

// The server's RETURNING clause is id/title/updated_at only — renaming
// doesn't change the message count, so the row isn't re-aggregated (see the
// chat-conversation-memory plan §2). Callers that need the full row
// (useConversations) merge this into their existing state rather than
// replacing it wholesale.
export function renameConversation(
  id: string,
  title: string,
): Promise<Pick<ConversationSummary, "id" | "title" | "updatedAt">> {
  return request(`chat/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export async function deleteConversation(id: string): Promise<void> {
  await request<{ ok: true }>(`chat/conversations/${id}`, { method: "DELETE" });
}
