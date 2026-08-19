# Chat System — End to End

> **This document is descriptive: it records how the chat system actually
> works today.** The earlier chat documents under `docs/plans/` are
> *prescriptive* — they laid out what the system could or should become before
> it was built, and may have drifted from what shipped. Where they disagree
> with this doc, this doc wins.
>
> - [`docs/plans/chatbot-plan.md`](./plans/chatbot-plan.md) — original
>   full-stack chatbot architecture plan.
> - [`docs/plans/chatbot-frontend.md`](./plans/chatbot-frontend.md) —
>   frontend-scoped companion (widget, profile button, usage meter).
> - [`docs/plans/chat-reliability-harness.md`](./plans/chat-reliability-harness.md)
>   — multi-model verifier/advisor harness plan.
> - [`docs/plans/chatbot-readiness-remediation-plan.md`](./plans/chatbot-readiness-remediation-plan.md)
>   — pre-launch readiness remediation plan.

An agentic, tool-calling RAG assistant over the Sky Atlas. The model never
answers from memory — every claim must be grounded in Atlas documents it
retrieves via tools, and citations are machine-verified. The entire chat
surface is gated behind `CHAT_ENABLED`; when off, `/api/chat`, `/api/auth/*`,
and `/api/usage` all 404.

## 1. Frontend (`src/components/chat/`)

`ChatWidget` is a floating panel (⌘K/Ctrl-K to open, Esc to close) mounted once
in the app shell, with `float` (corner card) and `anchored` (right column)
placements persisted in localStorage. `useChatStream.send(text, pageContext)`
POSTs `{ message, conversationId, pageContext }` to `/api/chat`, then reads the
response as a raw stream (not `EventSource`, since it's a POST), buffering on
`\n\n` and parsing `data:` SSE frames into typed `ChatEvent`s. A `dispatch()`
reducer mutates the last assistant message per event: `token` appends text,
`clear` wipes leaked pre-tool tokens, `tool_call`/`tool_result` build a trace,
`status` drives a ticker, `verify_result` drives a pass/warn/fail badge, and
`done` sets the authoritative final answer. The client `ChatEvent` union in
`api.ts` mirrors the server's `HarnessEvent` in `chat-orchestrator.ts` — they
must stay in sync.

## 2. Server lifecycle (`src/server/chat.ts`)

`handleChat` (mounted at `POST /api/chat`) runs in order:

1. **Auth** — `getSessionUser` (JWT cookie session); 401 if none.
2. **Validation** — reject empty and oversized messages (`MAX_MESSAGE_BYTES`).
3. **Rate-limit + commons gate** (parallel) — per-user rolling token window
   (default 500k tokens / 120 min; 429 with `Retry-After` if exceeded) and the
   account-wide OpenRouter credit pool (`fetchCommons`); if the pool is
   exhausted, chat is paused for everyone (429 `commons_exhausted`).
4. **Resolve conversation** — verify ownership of an existing `conversationId`
   or `INSERT` a new `conversations` row.
5. **Persist the user message** before streaming, then reload full history.
6. **Build the model input** — system prompt, windowed history, prefetch.
7. **Model tier routing** — `routeTier` + `resolveTierModels`.
8. **SSE stream** — emit `meta`, then run the harness, forwarding each event as
   `data: {json}\n\n`.
9. **Persist the assistant message** *after* the stream completes — never
   partial; skipped on abort. Harness rows go to `message_checks`.
10. **Observability** — a per-turn PostHog trace keyed by conversation id
    (semi-anonymous), not by user.

## 3. Model input

The per-request system prompt (`system-prompt.ts`) injects today's date + atlas
commit, the doc-type taxonomy with counts, the live entity-traversal graph, the
tool guide, and strict citation rules (every claim → a link with a verbatim UUID
from this turn's tool results). The citation FORMAT those rules ask for is
per-model: inline `[Title](/atlas/<uuid>)` by default, reference-style (a
`[label]: /atlas/<uuid>` definition block at the top, `[text][label]` in prose)
only for models listed in `CHAT_REFERENCE_CITATION_MODELS` — which defaults to
the literal list of models measured clean for the format (`openai/gpt-5.6-luna`,
`openai/gpt-5-mini`), independent of whichever model currently sits in
`CHAT_MODEL_STRONG`, so
swapping the strong tier doesn't silently change what format an unmeasured
model gets asked for. The pipeline accepts both from every model regardless; see
`docs/plans/reference-citations.md`. History is windowed to a hard char budget
(`chat-history.ts`). A deterministic **prefetch**
(`prefetch.ts`) matches the message against the glossary and entity roster and,
on a hit, injects a synthetic `atlas_prefetch` tool round so definitional
questions can answer in one pass. **Tier routing** (`model-router.ts`)
classifies the message by regex signals into FAST/DEFAULT/STRONG model chains —
free, no pre-flight LLM call; with no env config it's a no-op.

## 4. The agentic loop (`chat-loop.ts`)

`runChat` is a pure async generator (the LLM is injected as `ChatStream`, so it
unit-tests with no network/DB). Each iteration (max `chatMaxIterations = 4`)
streams a completion and accumulates content, tool-call deltas, `finish_reason`,
and usage (accumulated across rounds — load-bearing for rate limiting). If any
tool-call deltas accumulated, it emits `clear`, executes all calls in
parallel via `execToolDetailed`, appends results, and continues; otherwise the
content is the final answer and it emits `done`. The round is keyed on the
accumulated calls rather than `finish_reason == "tool_calls"`, because providers
differ on which reason they report alongside tool calls — but a `"length"`
finish still falls through to the answer path, since its call arguments were
cut off mid-JSON and must not be executed. The last allowed iteration
flips `tool_choice: "none"` and injects a final-turn instruction so no dangling
tool round is left open.

## 5. Tools & retrieval (`tool-registry.ts`, `search.ts`)

A single tool registry (`ATLAS_TOOLS`) is shared by chat (`llm-tools.ts`, which
converts each zod shape to JSON Schema) and the MCP server (`mcp.ts`), so an
external MCP client gets the exact same read-only tools. Search is **hybrid
RAG**: a lexical leg (in-memory MiniSearch / BM25, boosting title, doc_no, and
type) and a semantic leg (query embedded, then pgvector cosine search over
`atlas_doc_embeddings` with a relevance floor, degrading to lexical-only on
embed timeout), merged via Reciprocal Rank Fusion (`RRF_K = 60`). Graph, entity,
address, history, and curated `atlas_report_*` tools round out the set. Every
tool result is budget-capped (`chatToolResultMaxChars = 30k`).

## 6. Reliability harness (`chat-orchestrator.ts`)

`runVerifiedChat` wraps the loop and is what the SSE route iterates:

1. **Conversationalist pass** — runs `runChat`, forwarding token/tool/status
   events but holding back `done`.
2. **Deterministic checks** — `repairCitations` fixes/strips Atlas links, then
   `runDeterministicChecks` validates UUIDs, doc_nos, quotes, and addresses
   against the live indexes.
3. **Model verifier** (if `CHAT_VERIFIER_MODEL` set) — a JSON-mode, temp-0 audit
   that cross-checks each claim against evidence assembled from the transcript,
   producing supported/unsupported/contradicted claims → pass/warn/fail/
   unverified. Emits `verify_result` — it drives the badge but **never gates**
   the already-streamed answer. `invented_facts` is a severity *upgrade* only
   (warn → fail): it cannot fail an otherwise-clean claim table, because a real
   fabrication always also surfaces as an unsupported/contradicted claim, while
   a lone entry there is usually a wording critique.
4. **Advisor escalation** (if `CHAT_ADVISOR_MODEL` set) — on fail, on warn once
   `chatAdvisorTriggerUnsupportedClaims` (default 3) unsupported claims
   accumulate, or on non-pass with retrieval trouble / an exhausted loop.
   `adviseRecovery` returns requery/rewrite/decline, triggering exactly one
   revision + re-verify cycle. The revision replays the whole transcript, which
   is why a single unsupported claim no longer triggers it. On failure or abort,
   the original answer stands.

All harness activity is recorded to `message_checks`; every stage degrades
gracefully so harness flakiness never breaks a turn.

## 7. LLM & embeddings layer

Provider is **OpenRouter** via the `openai` SDK (swapping model/provider is a
config change, not code). The chat model is set via `CHAT_MODEL` —
**`google/gemma-4-31b-it`** in the current deployment (the code fallback default
is `qwen/qwen3-32b`) — at temperature 0.3, `max_tokens = 16000` per completion.
`makeOpenrouterStream` sets `stream_options.include_usage: true` (load-bearing —
otherwise streamed completions carry no usage for the rate limiter);
`makeOpenrouterJson` provides the non-streamed, temp-0 JSON call for the verifier
and advisor with a true request-cancelling timeout.

Embeddings use `EMBED_MODEL` (default `qwen/qwen3-embedding-8b`, native 4096
dims) sliced + L2-renormalized client-side to `EMBED_DIM = 1024` — a constant
locked to the `vector(1024)` column and HNSW index. `sync-embeddings.ts` is a
separate best-effort lane, incremental by unit `content_hash`, that keeps
`atlas_doc_embeddings` current. Embed text is `title + content` with markdown
links collapsed to their anchor text (93% of atlas links target a bare doc UUID,
which is pure token cost in a vector) — stripping happens only in
`buildEmbedText`, never in the parser or the lexical index.

Grouping is `kv_records_breadcrumbs`, a code constant rather than an env var. It
folds an Instance Configuration Document's parameter leaves — and other key/value
records (multisigs, contract-address blocks, risk-parameter blocks) — into one
compact anchor each, prefixed with a bounded ancestor breadcrumb. Decided
2026-08-18: it beat one-vector-per-doc on every metric (exact 0.642 vs 0.447,
disambiguation 0.550 vs 0.150, prose control 0.875 vs 0.800) with no slice
regressing. The decisive case is a parameter leaf like `Network / Ethereum
Mainnet`, too short to retrieve as its own vector — exact match on that slice went
from 3 of 40 to 18 of 40. See `scripts/eval/eval-retrieval.ts`'s header.

Folded members keep their own vector, flagged `attribution_only` (migration 023)
and excluded from search: once a group is retrieved, the query is re-embedded with
the retrieved anchor titles stripped out — inside a group the instance name
discriminates nothing — and members are scored against that residual to pick the
leaf. One extra embed per query, with a lexical fallback on any failure. Hybrid
search then fuses ancestor/descendant lexical+semantic
pairs onto the more specific doc (`via` on the tool result).

## 8. Data model (Postgres)

`conversations`, `messages` (assistant content written post-stream, never
partial; `generation_id` drives async cost backfill), and `message_checks` (one
row per harness activity) hold chat state; `users` backs OAuth + JWT sessions.
Retrieval tables are `atlas_doc_meta`, `atlas_doc_embeddings` (`vector(1024)` +
HNSW cosine index), `atlas_addresses`, and `atlas_history`, with
`sync_state`/`sync_log` as the "what's loaded" pointer. Document content,
full-text (MiniSearch), and the graph live **in memory** (loaded once at boot,
kept fresh by an in-process updater); Postgres holds only what benefits from SQL.

## 9. Streaming mechanism

SSE over a POST fetch body: the server writes `data: {json}\n\n` frames with
`content-type: text/event-stream`; the client reads the raw stream and
dispatches typed events (`meta`, `token`, `clear`, `tool_call`, `tool_result`,
`status`, `verify_result`, `done`, `error`). Aborts propagate via
`AbortController` → `req.signal`, canceling in-flight LLM rounds so orphaned tool
rounds don't burn tokens. `done.content` is always the authoritative answer —
streamed tokens may be cleared or revised before it arrives.
