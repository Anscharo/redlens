import { useCallback, useRef, useState } from "react";
import { apiUrl, type ChatEvent, type ToolCallRecord } from "./api";
import type { PageContext } from "./pageContext";

export interface TraceRow {
  name: string;
  args: Record<string, unknown>;
  ok: boolean | null; // null until the matching tool_result arrives
  bytes: number | null;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  trace: TraceRow[];
  rounds: number;
  sources: ToolCallRecord[]; // authoritative tool calls from `done`
  done: boolean;
}

export interface SendResult {
  rateLimited?: { message: string; resetsAt: string };
}

interface StreamHandlers {
  onDone?: () => void; // refresh usage, etc.
  onAuthError?: () => void; // 401 → openAuth()
}

// Parses a text/event-stream off a fetch ReadableStream. SSE frames are
// "data: <json>\n\n"; frames can split across chunk boundaries, so we buffer
// and only consume complete "\n\n"-terminated records.
export function useChatStream(handlers: StreamHandlers = {}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convIdRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Mutate the last (assistant) message in place.
  const patchLast = useCallback((fn: (m: ChatMsg) => ChatMsg) => {
    setMessages((prev) => {
      if (!prev.length) return prev;
      const next = prev.slice();
      next[next.length - 1] = fn(next[next.length - 1]);
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    patchLast((m) => (m.role === "assistant" ? { ...m, done: true } : m));
  }, [patchLast]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    convIdRef.current = null;
    setMessages([]);
    setError(null);
    setStreaming(false);
  }, []);

  const dispatch = useCallback(
    (ev: ChatEvent) => {
      switch (ev.type) {
        case "meta":
          convIdRef.current = ev.conversationId;
          break;
        case "token":
          patchLast((m) => ({ ...m, content: m.content + ev.text }));
          break;
        case "clear":
          // The round just streamed turned out to be a tool round — discard
          // any leaked answer fragments. done.content is authoritative.
          patchLast((m) => ({ ...m, content: "" }));
          break;
        case "tool_call":
          // rounds is bumped in the send loop (it has the contiguous-run state).
          patchLast((m) => ({
            ...m,
            trace: [...m.trace, { name: ev.name, args: ev.args, ok: null, bytes: null }],
          }));
          break;
        case "tool_result":
          patchLast((m) => {
            const trace = m.trace.slice();
            // Fill the most recent open row for this tool name.
            for (let i = trace.length - 1; i >= 0; i--) {
              if (trace[i].name === ev.name && trace[i].ok === null) {
                trace[i] = { ...trace[i], ok: ev.ok, bytes: ev.bytes };
                break;
              }
            }
            return { ...m, trace };
          });
          break;
        case "done":
          patchLast((m) => ({
            ...m,
            content: ev.content, // authoritative final answer
            sources: ev.toolCalls,
            done: true,
          }));
          break;
        case "error":
          setError(ev.message);
          patchLast((m) => ({ ...m, done: true }));
          break;
      }
    },
    [patchLast],
  );

  const send = useCallback(
    async (text: string, pageContext?: PageContext): Promise<SendResult> => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return {};
      setError(null);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed, trace: [], rounds: 0, sources: [], done: true },
        { role: "assistant", content: "", trace: [], rounds: 0, sources: [], done: false },
      ]);
      setStreaming(true);

      // Track tool rounds: count a "round" each time a new contiguous run of
      // tool calls begins after some answer streaming.
      let lastWasToolCall = false;

      try {
        const res = await fetch(apiUrl("chat"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversationId: convIdRef.current ?? undefined,
            pageContext,
          }),
          signal: ctrl.signal,
        });

        if (res.status === 401) {
          handlers.onAuthError?.();
          patchLast((m) => ({ ...m, done: true }));
          setStreaming(false);
          return {};
        }
        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
            resetsAt?: string;
          };
          const message = body.message ?? "Usage limit reached.";
          setError(message);
          patchLast((m) => ({ ...m, content: message, done: true }));
          setStreaming(false);
          return { rateLimited: { message, resetsAt: body.resetsAt ?? "" } };
        }
        if (!res.ok || !res.body) {
          throw new Error(`chat request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, nl);
            buffer = buffer.slice(nl + 2);
            const line = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let ev: ChatEvent;
            try {
              ev = JSON.parse(payload) as ChatEvent;
            } catch {
              continue;
            }
            if (ev.type === "tool_call") {
              if (!lastWasToolCall) patchLast((m) => ({ ...m, rounds: m.rounds + 1 }));
              lastWasToolCall = true;
            } else if (ev.type === "token") {
              lastWasToolCall = false;
            }
            dispatch(ev);
          }
        }
      } catch (err) {
        // AbortError (user pressed stop / closed) is expected — not an error.
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
          patchLast((m) => ({ ...m, done: true }));
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setStreaming(false);
        handlers.onDone?.();
      }
      return {};
    },
    [streaming, dispatch, patchLast, handlers],
  );

  return { messages, streaming, error, send, stop, reset };
}
