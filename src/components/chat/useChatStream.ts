import { useCallback, useRef, useState } from "react";
import { apiUrl, type ChatEvent, type Delivery, type ToolCallRecord, type VerifyClaim, type VerifyOverall } from "./api";
import type { PageContext } from "./pageContext";
import type { RateLimitState } from "./types";
import { downloadFile } from "../../lib/csvDownload";
import { absolutizeAtlasLinks } from "../../lib/routes";
import { track } from "../../lib/analytics";

export interface TraceRow {
  name: string;
  args: Record<string, unknown>;
  ok: boolean | null; // null until the matching tool_result arrives
  bytes: number | null;
  // "fact" rows are knowledge the server injected before the model ran (no call
  // to pair with a result, so they arrive already resolved). `summary` is the
  // server's reader-facing phrase for what it contributed.
  kind?: "tool" | "fact";
  summary?: string;
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

// One row per distinct stage the harness has entered, in arrival order. `at`
// is the entry's position in stageLog, not a wall-clock timestamp — keeps
// render output deterministic (see CLAUDE.md deterministic-builds convention,
// which this mirrors for UI state even though it isn't a build artifact).
export interface StageLogEntry {
  stage: string;
  detail: string | null;
  at: number;
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
  // Set when the turn ended via the SSE "error" event or a fetch/read
  // exception (never for the 429 path, which finalizes with its message as
  // `content` instead). Lets the UI distinguish "no answer because it broke"
  // from a genuinely empty response.
  failed?: boolean;
  exports?: ExportArtifact[]; // files handed to the user this session (live only)
  // Staged-mode progress checklist (populated in both modes; only rendered in
  // staged). Optional because hydrated/persisted messages (hydrate.ts) predate
  // it and never need it — send() seeds [] on live turns; readers `?? []`.
  stageLog?: StageLogEntry[];
  delivery?: Delivery; // captured from `meta`
}

export interface SendResult {
  rateLimited?: RateLimitState;
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
  // Mirrors convIdRef as state so callers (useChatSession, tests) can read it
  // reactively. The ref stays — send()'s closure over convIdRef.current is
  // what lets a reply land on the right conversation without re-subscribing.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // True context size of the last completed turn (last llm round's
  // prompt_tokens), for the Composer's context pie. Null when unknown.
  const [contextTokens, setContextTokens] = useState<number | null>(null);
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

  // Finalize only a still-running turn — see the call after the read loop.
  const finalizeIfPending = useCallback(() => {
    patchLast((m) => (m.role !== "assistant" || m.done ? m : { ...m, done: true, statusLine: null, failed: true }));
  }, [patchLast]);

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
    setConversationId(null);
    setMessages([]);
    setError(null);
    setStreaming(false);
    setContextTokens(null);
  }, []);

  // Seeds the stream with a restored conversation (or clears to a fresh chat
  // via hydrate(null, [])). Aborts any in-flight stream FIRST: patchLast
  // mutates whatever array is currently in `messages`, so if the old
  // stream's next event were dispatched after messages/convIdRef were
  // already reset but before the abort took effect, it would land on the
  // newly hydrated array and corrupt it. Aborting first — before the
  // request even changes — closes that window (see the
  // chat-conversation-memory plan §6).
  // `contextTokens` seeds the pie from the restored conversation's newest
  // assistant turn (ConversationDetail.contextTokens); defaults to null for
  // a fresh chat and any caller that predates this field.
  const hydrate = useCallback((id: string | null, msgs: ChatMsg[], contextTokens: number | null = null) => {
    abortRef.current?.abort();
    abortRef.current = null;
    convIdRef.current = id;
    setConversationId(id);
    setMessages(msgs);
    setError(null);
    setStreaming(false);
    setContextTokens(contextTokens);
  }, []);

  const dispatch = useCallback(
    (ev: ChatEvent) => {
      switch (ev.type) {
        case "meta":
          convIdRef.current = ev.conversationId;
          setConversationId(ev.conversationId);
          if (ev.delivery) patchLast((m) => ({ ...m, delivery: ev.delivery }));
          break;
        case "token":
          // Answer is streaming — the status ticker yields to the live text.
          patchLast((m) => ({ ...m, content: m.content + ev.text, statusLine: null }));
          break;
        case "status":
          patchLast((m) => {
            // Coalesce consecutive same-stage events into one row (querying
            // fires once per tool call — the row shows the latest detail); a
            // different stage appends a new row. `at` is the row's array
            // index at the moment it's first appended, and never changes on
            // a later detail-only update.
            const log = m.stageLog ?? [];
            const last = log[log.length - 1];
            const stageLog =
              last && last.stage === ev.stage
                ? [...log.slice(0, -1), { ...last, detail: ev.detail ?? null }]
                : [...log, { stage: ev.stage, detail: ev.detail ?? null, at: log.length }];
            return {
              ...m,
              statusLine: ev.detail ?? `${ev.stage}…`,
              stageLog,
              ...(ev.stage === "checking" && !m.verify
                ? { verify: { status: "checking" as const, claims: [], invalidCitations: [], invalidDocNos: [], docNoMismatches: [], ungroundedQuotes: [], ungroundedAddresses: [] } }
                : {}),
            };
          });
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
          // Markdown leaves the app, so rewrite the in-app citation links
          // (`/atlas/<id>`) to absolute URLs that resolve outside it. CSV is
          // left byte-for-byte as built server-side.
          const content = ev.format === "markdown" ? absolutizeAtlasLinks(ev.content) : ev.content;
          const artifact: ExportArtifact = {
            format: ev.format,
            filename: ev.filename,
            mime: ev.mime,
            content,
            bytes: content.length,
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
        case "facts":
          // Prepended, not appended: facts ran before the first tool call, so
          // the trace reads in the order things actually happened.
          patchLast((m) => ({
            ...m,
            trace: [
              ...ev.facts.map((fa) => ({
                name: fa.id,
                args: {},
                ok: true,
                bytes: null,
                kind: "fact" as const,
                summary: fa.summary,
              })),
              ...m.trace,
            ],
          }));
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
          setContextTokens(ev.contextTokens ?? null);
          break;
        case "error":
          setError(ev.message);
          finalizeLast({ failed: true });
          break;
      }
    },
    [patchLast, finalizeLast],
  );

  const send = useCallback(
    async (text: string, pageContext?: PageContext, delivery?: Delivery): Promise<SendResult> => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return {};
      setError(null);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setMessages((prev) => [
        ...prev,
        { role: "user", content: trimmed, trace: [], rounds: 0, sources: [], done: true, stageLog: [] },
        { role: "assistant", content: "", trace: [], rounds: 0, sources: [], done: false, stageLog: [] },
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
            ...(delivery ? { delivery } : {}),
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
            error?: string;
            message?: string;
            resetsAt?: string;
          };
          const message = body.message ?? "Usage limit reached.";
          // chat.ts sends an explicit discriminator ("rate_limited" carries
          // resetsAt; "commons_exhausted" never does) — fall back to the
          // resetsAt-presence heuristic only if that field is ever missing.
          const kind: "token" | "commons" =
            body.error === "commons_exhausted" ? "commons" : body.resetsAt ? "token" : "commons";
          // Deliberately not setError(message) here: `error` means "something
          // broke and we don't have a better explanation" (ChatPanel renders
          // it via ErrorNote). A 429 already has a full explanation — the
          // thread content below plus the returned `rateLimited` (which drives
          // RateLimitNote) — so leaving `error` untouched keeps the two UI
          // states disjoint. Otherwise the stale 429 text would resurface as
          // an "error" banner the instant the rate-limit lock lifts.
          finalizeLast({ content: message });
          setStreaming(false);
          return { rateLimited: { message, resetsAt: body.resetsAt, kind } };
        }
        if (res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (body.error === "conversation_not_found") {
            // The conversation was deleted elsewhere (another tab, or the
            // /conversations page) between hydrate and this send. Clear the
            // stale id so the NEXT send starts a fresh conversation
            // server-side, and finalize this turn as failed — Message.tsx's
            // own "didn't come through" copy — rather than routing it through
            // `error` (ErrorNote's generic banner), which would misrepresent
            // a stale reference as a real failure.
            convIdRef.current = null;
            setConversationId(null);
            setContextTokens(null);
            finalizeLast({ failed: true });
            setStreaming(false);
            return {};
          }
          throw new Error(`chat request failed (404)`);
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
        // The stream ended. If a terminal event ("done"/"error") came through
        // it already marked the message done and this no-ops; if the connection
        // was simply cut (proxy, server crash mid-turn) nothing else ever
        // would, and staged mode's checklist — which renders on `!done` —
        // would pulse forever behind an already-re-enabled input. Asking the
        // message whether it is still pending beats tracking a second list of
        // which event types count as terminal. `failed` only surfaces copy when
        // the answer is empty (Message.tsx); a partially streamed answer just
        // freezes as-is, which is what streaming mode already degraded to.
        finalizeIfPending();
      } catch (err) {
        // AbortError (user pressed stop / closed) is expected — not an error.
        if ((err as Error).name !== "AbortError") {
          setError((err as Error).message);
          finalizeLast({ failed: true });
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setStreaming(false);
        handlers.onDone?.();
      }
      return {};
    },
    [streaming, dispatch, patchLast, finalizeLast, finalizeIfPending, handlers],
  );

  return { messages, streaming, error, conversationId, contextTokens, send, stop, reset, hydrate };
}
