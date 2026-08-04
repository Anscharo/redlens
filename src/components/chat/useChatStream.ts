import { useCallback, useRef, useState } from "react";
import { apiUrl, type ChatEvent, type ToolCallRecord, type VerifyClaim, type VerifyOverall } from "./api";
import type { PageContext } from "./pageContext";
import { downloadFile } from "../../lib/csvDownload";
import { track } from "../../lib/analytics";

export interface TraceRow {
  name: string;
  args: Record<string, unknown>;
  ok: boolean | null; // null until the matching tool_result arrives
  bytes: number | null;
}

// Reliability-harness verdict for one assistant message. "checking" while the
// audit is in flight; "revised" when the answer was replaced after escalation.
export interface VerifyState {
  status: VerifyOverall | "checking" | "revised";
  claims: VerifyClaim[];
  invalidCitations: string[];
  invalidDocNos: string[];
  docNoMismatches: string[];
  ungroundedQuotes: string[];
  ungroundedAddresses: string[];
}

// A downloadable file the agent produced this session via export_findings.
// Auto-downloaded on arrival; kept on the message so the reply can offer a
// re-download button. Live-session only — not persisted across reloads.
export interface ExportArtifact {
  format: "markdown" | "csv";
  filename: string;
  mime: string;
  content: string;
  bytes: number;
}

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  trace: TraceRow[];
  rounds: number;
  sources: ToolCallRecord[]; // authoritative tool calls from `done`
  done: boolean;
  verify?: VerifyState;
  statusLine?: string | null; // transient harness status ticker (streaming only)
  exports?: ExportArtifact[]; // files handed to the user this session (live only)
}

export interface SendResult {
  // resetsAt is absent for the shared commons-pool gate (it has no fixed
  // reset time — cleared by a manual top-up) but present for the per-user
  // token-window gate.
  rateLimited?: { message: string; resetsAt?: string };
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

  // Terminate the last assistant message: mark done, drop the transient status
  // ticker, and resolve a still-"checking" verify chip so it can't pulse
  // forever when the stream ends by abort/error before verification resolves
  // (the "done" event has its own copy of this guard).
  const finalizeLast = useCallback(
    (extra: Partial<ChatMsg> = {}) => {
      patchLast((m) =>
        m.role === "assistant"
          ? {
              ...m,
              done: true,
              statusLine: null,
              ...(m.verify?.status === "checking" ? { verify: undefined } : {}),
              ...extra,
            }
          : m,
      );
    },
    [patchLast],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    finalizeLast();
  }, [finalizeLast]);

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
          // Answer is streaming — the status ticker yields to the live text.
          patchLast((m) => ({ ...m, content: m.content + ev.text, statusLine: null }));
          break;
        case "status":
          patchLast((m) => ({
            ...m,
            statusLine: ev.detail ?? `${ev.stage}…`,
            ...(ev.stage === "checking" && !m.verify
              ? { verify: { status: "checking" as const, claims: [], invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [] } }
              : {}),
          }));
          break;
        case "verify_result":
          patchLast((m) => ({
            ...m,
            verify: {
              status: ev.action === "revised" ? "revised" : ev.overall,
              claims: ev.claims,
              invalidCitations: ev.invalidCitations,
              invalidDocNos: ev.invalidDocNos,
              docNoMismatches: ev.docNoMismatches,
              ungroundedQuotes: ev.ungroundedQuotes,
              ungroundedAddresses: ev.ungroundedAddresses,
            },
          }));
          break;
        case "clear":
          // The round just streamed turned out to be a tool round — discard
          // any leaked answer fragments. done.content is authoritative.
          patchLast((m) => ({ ...m, content: "" }));
          break;
        case "export": {
          // Auto-download the file the moment it arrives (CSV keeps the Excel
          // BOM; markdown doesn't). A gesture-strict browser (Safari) may block
          // this async download — the persistent button rendered from
          // m.exports is the gesture-safe fallback + re-download.
          const artifact: ExportArtifact = {
            format: ev.format,
            filename: ev.filename,
            mime: ev.mime,
            content: ev.content,
            bytes: ev.bytes,
          };
          try {
            downloadFile(artifact.filename, artifact.content, artifact.mime, artifact.format === "csv");
          } catch {
            // Blocked/unsupported — the fallback button still lets the user save it.
          }
          track("chat_export", { format: artifact.format, bytes: artifact.bytes });
          patchLast((m) => ({ ...m, exports: [...(m.exports ?? []), artifact] }));
          break;
        }
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
            // Fill the OLDEST open row for this tool name — the server emits
            // tool_result events in call order (chat-loop.ts pushes results in
            // parsedCalls order regardless of Promise.all completion order), so
            // a forward scan keeps repeated-tool-name rounds correctly paired.
            for (let i = 0; i < trace.length; i++) {
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
            statusLine: null,
            // A "checking" chip that never resolved (verifier off/failed
            // silently) must not spin forever.
            ...(m.verify?.status === "checking" ? { verify: undefined } : {}),
          }));
          break;
        case "error":
          setError(ev.message);
          finalizeLast();
          break;
      }
    },
    [patchLast, finalizeLast],
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

      // Track tool rounds: count a "round" for each contiguous batch of
      // tool calls. A later tool round may begin after only tool results +
      // status events (no answer token), so close the batch when every
      // pending tool_call has received its tool_result.
      let inToolRound = false;
      let pendingToolResults = 0;

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
          finalizeLast();
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
          finalizeLast({ content: message });
          setStreaming(false);
          return { rateLimited: { message, resetsAt: body.resetsAt } };
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
              if (!inToolRound) patchLast((m) => ({ ...m, rounds: m.rounds + 1 }));
              inToolRound = true;
              pendingToolResults += 1;
            } else if (ev.type === "tool_result") {
              pendingToolResults = Math.max(0, pendingToolResults - 1);
              if (pendingToolResults === 0) inToolRound = false;
            } else if (ev.type === "token" || ev.type === "done" || ev.type === "clear") {
              inToolRound = false;
              pendingToolResults = 0;
            }
            dispatch(ev);
          }
        }
      } catch (err) {
        // AbortError (user pressed stop / closed) is expected — not an error.
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
          finalizeLast();
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setStreaming(false);
        handlers.onDone?.();
      }
      return {};
    },
    [streaming, dispatch, patchLast, finalizeLast, handlers],
  );

  return { messages, streaming, error, send, stop, reset };
}
