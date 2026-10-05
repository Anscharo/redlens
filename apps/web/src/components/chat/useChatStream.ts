import { useCallback, useRef, useState } from "react";
import type { PageContext } from "./pageContext";
import type { ChatMsg } from "./chatTypes";
import type { StreamHandlers } from "./chatRefusal";
import { createStreamCore, streamControls } from "./streamCore";
import { sendTurn } from "./sendTurn";

// Re-exported so `from "./useChatStream"` imports keep working — the shared
// shapes live in chatTypes.ts / types.ts.
export type {
  ChatMsg,
  TraceRow,
  VerifyState,
  ExportArtifact,
  StageLogEntry,
  SupersededDraft,
} from "./chatTypes";
export type { SendResult } from "./types";

// The chat thread and its live stream. `send(text, pageContext)` POSTs a turn
// and folds its SSE events onto the last message (sendTurn.ts); `stop`,
// `reset` and `hydrate` are stable for the hook's life (streamCore.ts).
// `contextTokens` is the true context size of the last completed turn, for
// the Composer's context pie; null when unknown.
export function useChatStream(handlers: StreamHandlers = {}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [contextTokens, setContextTokens] = useState<number | null>(null);
  const convIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [core] = useState(() =>
    createStreamCore({ setMessages, setStreaming, setError, setConversationId, setContextTokens, convIdRef, abortRef }),
  );
  const [controls] = useState(() => streamControls(core));
  const send = useCallback(
    (text: string, pageContext?: PageContext) => sendTurn(core, { text, pageContext, streaming, handlers }),
    [core, streaming, handlers],
  );
  return { messages, streaming, error, conversationId, contextTokens, send, ...controls };
}
