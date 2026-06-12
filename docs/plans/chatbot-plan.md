  # Redline Atlas Reader — Chatbot Architecture Plan

  ## Overview

  A governance chatbot for the Sky Atlas, accessible as a floating widget on every page of the Redline Atlas Reader. Aware of the page the user is currently viewing. Backed by a server-side LLM with full atlas search and graph traversal.

  ---

  ## Architecture

  ```
  Browser
      │
      ▼
  Cloudflare (proxied DNS, CDN, WAF, edge TLS)
      │  caches /assets/*, /*.js, /*.css aggressively
      │  bypasses cache for /, /api/*, SPA routes
      ▼
  Railway (single project, single custom domain — atlas.redline.support)
      │
      ├── Bun service — serves both the SPA bundle AND /api/*
      │     ├── static: dist/ (Vite build) with SPA fallback → index.html
      │     ├── /api/chat (SSE)
      │     ├── /api/auth/* (OAuth callbacks)
      │     ├── OpenRouter SDK → LLM
      │     ├── in-memory indexes (loaded from build artifacts on boot)
      │     │     ├── graphology graph        (from graph.json — full backend graph)
      │     │     ├── minisearch FTS          (from docs.json)
      │     │     └── doc content map         (from docs.json)
      │     └── atlas_query tool — mode-routed
      │           ├── search (lexical)        → minisearch
      │           ├── search (semantic/hybrid)→ pgvector + minisearch RRF
      │           ├── graph / enumerate / coverage → graphology
      │           ├── addresses / history     → Postgres
      │           └── content lookup by id    → in-memory doc map
      │
      └── Postgres (single DB)
            ├── chat tables (users, conversations, messages)
            └── atlas tables (doc_meta, doc_embeddings, addresses, history)
  ```

  Everything Redline Atlas Reader runs on Railway. Cloudflare sits in front as a CDN / edge layer only — no D1, no Vectorize, no Workers. Single origin, single domain, single Postgres.

  **Split rationale.** The atlas is read-only between updates, so most of its bulk (content + graph structure + lexical index) lives in memory inside each Bun process — loaded from build artifacts at boot. Postgres holds only what genuinely benefits from SQL: vector embeddings (pgvector + HNSW), address chain-state (JSONB), git history (time-series analytics), and a slim `atlas_doc_meta` table so we can still join structural metadata into pgvector + history + chat-analytics queries.

  ---

  ## Services

  ### Railway Service — Bun
  - **Runtime**: Bun (native HTTP server, no framework needed)
  - **Auth**: `arctic` — GitHub OAuth (MVP); Google OAuth (v1) → JWT in signed HTTP-only cookies
  - **LLM**: `openai` SDK pointed at `https://openrouter.ai/api/v1`, provider-agnostic
  - **Tool layer**: `atlas_query` is mode-routed across in-memory indexes + Postgres. **Factor as pure, transport-agnostic functions** (no HTTP/MCP coupling) so the same code backs `/api/chat` in-process *and* a future MCP surface — see MCP note below. Large parts port directly from `redlens-mcp/src/index.ts`: `rrfMerge`, the row/result shaping, and the zod tool schemas reuse as-is; only the data adapters change (FTS5→minisearch, Vectorize→pgvector). The real reimplementation is the `atlas_query` graph sub-modes (`entity_chain`, `entity_broad`, `type_list`, `entity_narrow`) — D1 recursive CTEs become graphology traversals.
    - `search` lexical → minisearch (in-memory)
    - `search` semantic → pgvector
    - `search` hybrid → pgvector + minisearch, RRF merge in JS
    - `graph` / `enumerate` / `coverage` → graphology (in-memory)
    - `addresses` / `history` → Postgres
    - `atlas_describe` → in-memory graph node-type + edge-kind catalog
  - **MCP surface — deferred (do-if-easy).** The existing CF Worker is a live MCP endpoint (`ask-atlas` and other clients depend on `mcp__redlens__atlas_*`). Re-exposing MCP from Bun is *moderate* effort — an HTTP/SSE transport (Node-HTTP assumptions are a Bun compat risk) + a separate API-key auth model (distinct from the chat UI's OAuth cookies) + repointing consumers — so it is **not in the MVP**. The cheap insurance is the transport-agnostic tool factoring above; the MCP transport is then a thin wrapper added later. Until it lands, **keep the CF Worker serving MCP** as a temporary bridge (do *not* run the step-12 decommission early) so `ask-atlas` keeps working.
  - **Analytics**: SQL on chat tables; structural joins through `atlas_doc_meta`
  - **Endpoint**: `POST /api/chat` — SSE stream, agentic loop calling `atlas_query` directly. Hard `maxIterations` guard (e.g. 6) enforced in server code — the system prompt budget is advisory only and must not be the sole termination mechanism. At stream-end, persist the `x-openrouter-generation-id` to the message row and record `input_tokens`/`output_tokens` (known immediately from the final usage event). **`cost_usd` is backfilled asynchronously (v1)** — `GET /api/v1/generation?id=…` returns `total_cost` with a seconds-to-minutes delay, so a background reconciler fetches it later rather than blocking the response. See #8 in the sync/rate-limit notes. No local price map needed.
  - **`GET /api/auth/me`** — returns `{ id, name, avatarUrl, provider }` or `401`; called on app boot to hydrate auth state.
  - **`POST /api/auth/signout`** — clears JWT cookie, returns `200`.
  - **`GET /api/usage`** — returns `{ userTokens, allTokens, globalLimit, windowTokens, windowLimit, windowResetsAt }` for the rate limit UI.
  - **`GET /health`** — Railway health check; ports over from the existing Cloudflare Worker. Returns `200 OK` with `{ status: "ok", atlas_sha }`. Railway gates rolling deploys on this.
  - **Shared OAuth popup util** — `openAuthPopup()` used by both the profile button and the chat widget. One implementation, two entry points.

  ### Postgres (single DB) — Railway
  - **Extensions**: `pgvector` (semantic)
  - **Chat schema**: `users`, `conversations`, `messages`
  - **Atlas schema**: `atlas_doc_meta` (slim structural columns only — no content, no tsv), `atlas_doc_embeddings`, `atlas_addresses`, `atlas_history`
  - **Refresh**: `pnpm sync:atlas` writes the atlas tables from build artifacts (`docs.json`, `addresses.atlas.json`, `chain-state.json`, `history/*.json`) on every atlas update. The in-memory indexes need no separate publish step. Artifact provenance splits two ways: the tracked artifacts (`graph.json`, `relations.json`, `addresses.atlas.json`, `chain-state.json`, `history/`, `manifest.json`) are committed by the atlas-update PR and ship in the image; the gitignored ones (`docs.json`, `search-index.json`) are regenerated **deterministically from the committed atlas submodule** during Railway's build step. Either way both are on disk at boot — no Railway volume.

  ### In-memory indexes
  All three loaded from build artifacts on boot. Total ~70–100 MB per Bun process.

  **Graphology graph** — `MultiDirectedGraph` from `graph.json` (the **full backend graph**, not the frontend-trimmed `relations.json`):
  - Nodes: docs + entities + addresses — every addressable atlas thing, with full attributes (`type`, `name`, `slug`, `props`, extraction provenance)
  - Edges: every kind emitted by `build-graph` (`parent_of`, `instance_of`, `has_address`, `executor_of`, `signer_of`, `references`, …) with full `props`
  - ~30–50 MB

  **minisearch FTS** — built from `docs.json` at boot:
  - Fields: `title^3`, `content`, `type^2`, `doc_no`
  - Active maintenance, BM25 ranking, fuzzy matching, faceting
  - Replaces MiniSearch (frontend) and Postgres FTS (planned) — one library, in-process, sub-ms queries
  - ~15–25 MB

  **Doc content map** — `Map<uuid, { title, doc_no, type, content, parent_id, depth }>` from `docs.json`:
  - Backs every content-by-id lookup after a vector or graph query
  - ~20 MB

  **Refresh:** on every Railway deploy, boot-time sync updates Postgres then the in-memory indexes load from the artifacts on disk — `public/graph.json` (committed by the atlas-update PR) and `public/docs.json` (regenerated deterministically from the committed atlas submodule during Railway's build step). Each replica loads its own copy — static data, no consistency problem, no volume. No manual reload endpoint needed.

  ### Frontend — Vite SPA, served by Bun
  - Built with `pnpm build`, output to `dist/`
  - Served by the same Bun process that runs `/api/*` — no separate static service
  - **SPA fallback**: any non-asset, non-API path returns `index.html` so wouter routes resolve client-side:
    ```ts
    Bun.serve({
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/")) return apiHandler(req);
        const file = Bun.file(`dist${url.pathname}`);
        if (await file.exists()) return new Response(file);
        return new Response(Bun.file("dist/index.html"));  // SPA fallback
      }
    });
    ```
  - **`base` stays parameterized during parallel-run.** `vite.config.ts` already switches base by env (`CF_PAGES === "1" ? "/" : "/redlens/"`); Railway builds with the apex flag → `base: '/'`, while the GH Pages fallback keeps building `base: '/redlens/'`. All `import.meta.env.BASE_URL` usages work under both. The `/redlens/` variant is dropped only at **final cutover** (when GH Pages is decommissioned, Build Order step 12) — not before, or the fallback breaks.

  ### Frontend — profile button (top-right header)

  Lives in the NavBar, right side. Requires a `GET /api/auth/me` call on app boot to determine auth state — HTTP-only cookies aren't readable by JS, so the server is the source of truth. Response is cached in app-level state (React context or a simple module-level promise).

  **`GET /api/auth/me`** — returns `{ id, name, avatarUrl, provider }` if authenticated, `401` if not. Called once on load; result drives all auth-gated UI.
  **`POST /api/auth/signout`** — clears the JWT cookie, returns `200`. Frontend resets auth state to unauthenticated.

  **Draft persistence** — the chat input is mirrored to `localStorage` (key: `chat-draft`) on every keystroke (debounced). Restored on widget open. Cleared on successful send. User never loses a typed message across refreshes, crashes, or accidental widget closes.

  **Logged-out state:** a "Sign in" button (or person icon). Click triggers the same GitHub OAuth popup as the chat widget — one consistent auth flow across the app.

  **Logged-in state:** circular GitHub avatar (`avatarUrl` from `/api/auth/me`). Click opens a dropdown:

  ```
  ┌─────────────────────┐
  │ ● Name              │
  │   github            │
  ├─────────────────────┤
  │   Preferences   →   │
  ├─────────────────────┤
  │   Sign out          │
  └─────────────────────┘
  ```

  **Preferences sub-panel** (v1 scope — surface existing local storage settings):
  - Color scheme toggle — handled separately, will slot in here when ready
  - Any other existing local-storage-backed UI prefs (tree collapse state, etc.)

  **Future (v1+):** conversation history list moves here.

  ---

  ### Frontend — floating chat widget
  - Lives in `App.tsx` shell, visible on every page
  - Injects current page context into each message:
    - Atlas node being viewed (UUID, title, doc_no)
    - Current route (atlas / radar / reports)
    - Entity slug if on radar page
  - Loads conversation history from `/api/conversations`
  - Streams responses token-by-token via SSE
  - **AbortController on every request** — each `POST /api/chat` is tied to an `AbortController`; signal is passed to `fetch`. Aborted on widget close, new message sent, or unmount. Server must check `req.signal` / connection close and exit the agentic loop immediately to avoid burning tokens on orphaned tool calls.
  - Shows `atlas_query` tool call traces (dev/debug toggle, off by default)

  ---

  ## Chat UI/UX

  ### States

  **Collapsed** — pill-shaped floating input bar, bottom-right. Placeholder is context-aware:
  - On an atlas node: *"Ask about [node title]..."*
  - Elsewhere: *"Ask about the Sky Atlas..."*

  **Expanded** — slides up from bottom-right into a resizable panel. Corner drag handle (bottom-left of panel) supporting both vertical and horizontal resize. Constraints: max `100vh` tall, max `50vw` wide; min `320×280px`. Size persists across collapse/expand within a session; resets to default on next visit. Adapts the existing right panel resize logic (which is horizontal-only) to support corner/bidirectional drag.

  **Mobile** — full-screen takeover on narrow viewports (below Tailwind `md` breakpoint). No resize handle.

  ### Auth

  Unauthenticated users see the collapsed input and can type freely. On submit or focus:
  - `window.open('/api/auth/github', 'auth', 'width=600,height=700')` — OAuth in a popup (triggered by direct user click, so popup blockers don't fire)
  - Popup callback page calls `window.opener.postMessage({ type: 'auth_complete' }, origin)` and closes
  - Widget receives the message, cookie is set, conversation opens with typed text pre-filled
  - Fallback: if `window.open` returns `null` (popup blocked), fall back to full redirect with `?return=` param

  ### Page context badge

  Top of the expanded panel, passive, no interaction:
  ```
  📍 Viewing: Atlas Axis                    [×]
  ```
  Explains to users why the model already knows what they're looking at. No @mention syntax needed.

  Shown on every page, as specific as possible:
  - **Atlas** — doc UUID + title of the currently selected node. Straightforward.
  - **Radar** — actor slug + entity name. What additional context to inject (active tab, visible instances, etc.) needs a dedicated spike — the radar page surfaces a lot of structured data and the right granularity isn't obvious yet.
  - **Reports** — report name + selected entity/section if applicable.

  ⚠️ *Radar context injection is a spike item — needs further design before implementation.*

  ### Rendering

  Uses `react-markdown` + `remark-gfm`. Custom link component intercepts `/atlas/<uuid>` hrefs for SPA navigation (same pattern as `NodeContent.tsx`) — atlas doc links from the model open the node in the reader without a page reload.

  **Rendered:** streaming markdown, inline code, code blocks, bold/italic, lists, blockquotes, markdown tables, atlas doc links.

  **Not rendered (deferred):** KaTeX/math, inline widgets, data artifacts, interactive tables. System prompt instructs the model not to generate these.

  **Streaming code fence fix:** if the accumulated stream string has an odd number of ` ``` ` delimiters, append a synthetic closing fence before passing to the renderer; remove it when the stream ends. Prevents the rest of the response from collapsing into a code block mid-stream.

  **Atlas doc quotes:** model is instructed (system prompt) to quote at most 1–2 sentences from any atlas document, always followed by a link: `[Node Title](/atlas/<uuid>)`. Never reproduce full doc content in chat — link to the reader instead.

  ### Conversations

  **MVP:** widget always opens a new conversation. Conversations are still persisted to the DB (for analytics and future history UI) but the user has no way to navigate back to them yet.

  **v1:** last conversation resumes on widget open; "New conversation" button in panel header; conversation list via history icon (alongside conversation search).

  ### Cloudflare — CDN only
  - Proxied DNS (orange cloud) pointing at the Railway custom domain
  - Cache rules:
    - `/assets/*`, `/*.js`, `/*.css`, anything with a Vite content hash → cache 30 days (Vite uses content-hashed filenames, so this is safe; shorter than the conventional 1y for faster recovery if a broken asset slips through)
    - `/`, `/api/*`, all SPA routes (`/atlas/*`, `/radar/*`, `/reports/*`) → bypass cache
  - Edge TLS + WAF + DDoS protection come for free
  - No Workers, no D1, no Vectorize — pure caching proxy (target state). **Exception during the bridge period:** the existing CF Worker keeps serving the MCP endpoint until the deferred Bun MCP surface lands (see Bun service "MCP surface" note). It retires at that point, leaving CF as pure CDN.

  ---

  ## Database Schema (Railway Postgres — single DB)

  ### Chat schema

  ```sql
  CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider     TEXT NOT NULL,        -- 'github' (MVP); 'google' (v1)
    provider_id  TEXT NOT NULL,
    email        TEXT,
    name         TEXT,
    created_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(provider, provider_id)
  );

  CREATE TABLE conversations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),
    title               TEXT,          -- first ~60 chars of first message
    page_context        JSONB,         -- { path, nodeId, nodeTitle, nodeDocNo, actorSlug }
    model               TEXT,
    total_input_tokens  INT DEFAULT 0,
    total_output_tokens INT DEFAULT 0,
    total_cost_usd      DECIMAL(10,6) DEFAULT 0,
    query_atlas_calls   INT DEFAULT 0,
    summary             TEXT,          -- compacted summary of messages before summary_upto_id
    summary_upto_id     UUID           -- last message id included in summary (FK set after messages exist)
  );

  CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    role            TEXT NOT NULL,     -- 'user' | 'assistant'
    content         TEXT NOT NULL,     -- written after stream completes (async, non-blocking to user); never partial
    tool_calls      JSONB,             -- [{ mode, input, result }]
    input_tokens    INT,
    output_tokens   INT,
    generation_id   TEXT,              -- x-openrouter-generation-id; saved at stream-end, drives async cost backfill
    cost_usd        DECIMAL(10,6),     -- NULL until the background reconciler fetches it (v1); see #8
    latency_ms      INT
  );
  ```

  A sweeper (cron or delayed task) selects messages where `generation_id IS NOT NULL AND cost_usd IS NULL`, fetches `GET /api/v1/generation?id=…`, and backfills `cost_usd` with retry/backoff. Until backfilled, per-user dollar spend under-counts — which is why MVP rate-limiting leans on the token window (known at stream-end), not dollars.

  ### Atlas schema (vectors / addresses / history + slim metadata — content, FTS, and graph are in memory)

  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;

  -- Structural metadata only — no content, no tsv. Lets us:
  --   - pre-filter pgvector results by type / parent / depth (selective filters keep recall high)
  --   - GROUP BY type/scope in atlas_history analytics
  --   - JOIN chat tables (messages.tool_calls JSONB → doc_id) without going through the API
  -- Full doc content + FTS live in the in-memory indexes loaded from docs.json.
  CREATE TABLE atlas_doc_meta (
    id            UUID PRIMARY KEY,         -- atlas node UUID
    doc_no        TEXT NOT NULL,
    title         TEXT NOT NULL,
    type          TEXT NOT NULL,            -- Scope|Article|Section|Core|...
    depth         INT  NOT NULL,
    parent_id     UUID,
    content_hash  TEXT NOT NULL,            -- sha256 of cleanContent — diff key for incremental sync
    atlas_sha     TEXT NOT NULL             -- last sha at which this row changed
  );
  CREATE INDEX atlas_doc_meta_type   ON atlas_doc_meta(type);
  CREATE INDEX atlas_doc_meta_parent ON atlas_doc_meta(parent_id);

  CREATE TABLE atlas_doc_embeddings (
    doc_id     UUID PRIMARY KEY REFERENCES atlas_doc_meta(id) ON DELETE CASCADE,
    embedding  vector(1024) NOT NULL,     -- qwen3-embedding-8b, MRL-truncated to 1024-dim
    atlas_sha  TEXT NOT NULL
  );
  CREATE INDEX atlas_emb_hnsw ON atlas_doc_embeddings
    USING hnsw (embedding vector_cosine_ops);

  CREATE TABLE atlas_addresses (
    address        TEXT PRIMARY KEY,        -- 0x… (lowercased) or solana base58
    chain          TEXT NOT NULL,
    chainlog_id    TEXT,
    entity_label   TEXT,
    aliases        TEXT[],
    roles          TEXT[],
    is_contract    BOOLEAN,
    is_proxy       BOOLEAN,
    implementation TEXT,
    chain_state    JSONB,                  -- multicall snapshot (signers, thresholds, …)
    content_hash   TEXT NOT NULL,          -- sha256 of merged annotation record — diff key
    atlas_sha      TEXT NOT NULL
  );

  -- substantive change record, at commit/PR granularity (built by build-history)
  CREATE TABLE atlas_history (
    doc_id       UUID NOT NULL,
    commit_sha   TEXT NOT NULL,
    committed_at TIMESTAMPTZ NOT NULL,
    pr_number    INT,
    summary      TEXT,
    diff_size    INT,                      -- chars changed
    change_type  TEXT NOT NULL,            -- 'added' | 'content' | 'structural' | 'removed'
    content_hash TEXT,                     -- hash at this revision; null for 'removed'
    PRIMARY KEY (doc_id, commit_sha)        -- append-only; never UPDATE/DELETE
  );
  CREATE INDEX atlas_history_time   ON atlas_history(committed_at);
  CREATE INDEX atlas_history_change ON atlas_history(change_type);

  -- single-row pointer to "what's loaded"
  CREATE TABLE sync_state (
    id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    atlas_sha  TEXT NOT NULL,
    synced_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  -- thin operational ledger (one row per deploy that changed data)
  CREATE TABLE sync_log (
    id          BIGSERIAL PRIMARY KEY,
    atlas_sha   TEXT NOT NULL,             -- sha after this sync
    prev_sha    TEXT,                      -- sha before; (prev_sha, atlas_sha] is the change window
    inserted    INT  NOT NULL,
    updated     INT  NOT NULL,
    deleted     INT  NOT NULL,
    started_at  TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX sync_log_atlas_sha ON sync_log(atlas_sha);
  ```

  **Two change records, different granularities.** `atlas_history` is the substantive, commit-grained record built from the atlas git log — it answers trend questions (filter `change_type='content'` to drop renumber noise) and is the source for memory invalidation. `sync_log` is the thin, deploy-grained operational ledger: it records that we moved `prev_sha → atlas_sha` at a given time, touching N rows. The *what-changed* detail is recovered from `atlas_history` rows in the `(prev_sha, atlas_sha]` window at proper per-commit resolution — not flattened to the arbitrary deploy boundary. Per-row `atlas_sha` on the data tables records last-modified-at-sha (provenance); `sync_state.atlas_sha` is the global pointer to what's currently loaded.

  ---

  ## Sync

  **Trigger: deploy = sync.** Build artifacts live in git (the atlas-update PR adds them to `public/`), so every Railway deploy ships with the right artifacts. On boot the Bun process compares the artifact `atlas_sha` (from `public/manifest.json`) against `sync_state.atlas_sha`; mismatch → run sync. No separate webhook or cron.

  **Incremental row-diff, not full replace.** Per table, keyed by primary key (UUID / address / commit_sha), sync computes inserts / updates / deletes and applies only those:
  - `content_hash` is the diff key. Unchanged docs are skipped entirely.
  - **Embeddings are NOT written in this transaction.** Structural sync only records the changed-doc set; the embedding *vectors* are reconciled afterward in the separate best-effort lane (see Embeddings → "Generation"). A changed `content_hash` is the signal that the embedding is stale, not a trigger to embed inline — so a slow or failing OpenRouter never blocks structural sync.
  - `atlas_history` is append-only — sync only INSERTs commits newer than `MAX(committed_at)`.
  - A typical atlas update touches ~10–100 docs out of ~10K, so sync touches tens of rows, not thousands.

  **What actually matters: idempotent, sha-gated sync.** At ~50 users (≈0.03 queries/sec) we run **a single replica** — there's no throughput or memory reason to scale out. So the two load-bearing pieces are needed even with one instance, because *every redeploy* re-runs sync on boot:
  - **Single transaction.** Sync runs in one PG transaction (rolls back cleanly on failure — PG never holds a half-updated state).
  - **Gate on sha.** On boot, check `sync_state.atlas_sha == manifest sha`. Equal → skip sync entirely (the steady-state case). Mismatch → run it.
  - **Ordering invariant: PG before memory.** Start command is `pnpm sync:atlas && bun src/server.ts`. PG must be current before the in-memory indexes load, because vector search returns doc IDs the in-memory content map must resolve. If sync fails, the process exits, the health check fails, and the prior healthy replica keeps serving.

  **Advisory lock — cheap insurance, not a load-bearing concern.** Two replicas only ever coexist during the ~30s rolling-deploy overlap, and a true concurrent-sync race needs replica-count > 1 (which we won't set). Still, wrap the sync txn in a `pg_advisory_lock`: the winner syncs, any other booting replica takes the **blocking** lock, waits for the commit, then re-checks the gate before serving. It's ~3 lines and harmless — keep it so it's not a retrofit if replica count ever changes, but don't invest beyond that.

  **Rolling-deploy window.** During a ~30s rolling deploy, old replicas serve old in-memory indexes while PG flips to the new sha. Worst case: an old replica references a just-deleted UUID and returns "not found" for ~30s. Acceptable for a governance chatbot; switch Railway to drain-then-replace if zero-inconsistency is ever required.

  ### Build-side requirements

  - **`build-index`** writes `content_hash` per doc into `docs.json` — `sha256` of **content + title only**, excluding `doc_no`/`parent_id`/`depth`. This exclusion is load-bearing: it's what lets a pure renumber (PR #235-style) land as `structural`, not `content`, so it doesn't trigger embedding rewrites or memory invalidation.
  - **`build-addresses`/`build-graph`** write `content_hash` per address (hash of the merged annotation record) into `addresses.atlas.json`.
  - **`build-history`** already emits per-revision change events — this is a *reconciliation*, not greenfield. It currently produces `change_type` ∈ `added | modified | removed | moved` (used today on the radar pages) and hashes full content with **md5**. Three deltas to align with this schema: (1) map the vocabulary — `modified`→`content`, `moved`→`structural`, `added`/`removed` unchanged; (2) hash **content + title only** (excluding doc_no/parent/depth) so a pure renumber lands as `structural`/`moved`, matching the `build-index` hash above; (3) switch md5→`sha256`. Stays deterministic — fits `REPRO=1`.

  ---

  ## Models

  Single model for all users — no user-facing switching (can be added later). Active model set via `CHAT_MODEL` env var; `getModel(modelId, env)` factory makes it a one-config swap.

  All models via OpenRouter. OpenRouter passes through provider pricing with no markup.

  | Model | OR slug | Input $/M | Output $/M | Per query* | Notes |
  |---|---|---|---|---|---|
  | Qwen3 32B | `qwen/qwen3-32b` | $0.08 | $0.28 | ~$0.0007 | **Default** — confirmed tool use, proven reliability |
  | Gemma 4 26B A4B | `google/gemma-4-26b-a4b-it` | $0.06 | $0.33 | ~$0.0006 | ⚠️ tool use not confirmed via OpenRouter endpoint — promote to default if verified |
  | Gemma 4 31B | `google/gemma-4-31b-it` | $0.12 | $0.37 | ~$0.0009 | ⚠️ same caveat; dense variant, 262K ctx |
  | Claude Haiku 4.5 | `anthropic/claude-haiku-4-5` | $1.00 | $5.00 | ~$0.009 | Premium fallback |
  | Claude Sonnet 4.6 | `anthropic/claude-sonnet-4-6` | $3.00 | $15.00 | ~$0.028 | High-stakes queries |

  *~6,600 input / 550 output tokens per query (system prompt + 2 atlas_query calls + answer)

  ---

  ## Embeddings

  Semantic search runs on **`qwen/qwen3-embedding-8b`** via OpenRouter — same `OPENROUTER_API_KEY` as the LLM, no separate provider. Replaces the previous bge-base-en (Workers AI) setup; this takes Cloudflare out of the data plane entirely (pure CDN, per the architecture thesis).

  - **Dimension: 1024** — Qwen3 is MRL-trained (512/1024/2048 prefixes), so truncating the native 4096-dim vector to 1024 retains ~95% retrieval quality at 25% storage. `atlas_doc_embeddings.embedding` is `vector(1024)`; HNSW cosine index unchanged in shape. If OpenRouter doesn't honor a server-side `dimensions` param for Qwen3, slice to the first 1024 dims client-side and L2-renormalize (the existing semantic path already L2-normalizes).
  - **Why upgrade from bge-base:** corpus is dense governance/technical English where bge-base (small 2023 model) is weakest; Qwen3-8B tops MTEB retrieval. Cost is trivial — query embeds ≈ $0.02/mo at projected volume.
  - **Context: 32K** — every atlas doc fits whole (max ~2,471 tokens), which **retires the deferred long-node chunking item** — no chunking needed.
  - **Both sides embedded raw for MVP.** Qwen3 supports an optional query-side instruction prefix (+1–5% recall, asymmetric query/doc encoding), but it is *not* required and is deferred — symmetric raw embedding matches today's bge behavior and is simpler. Revisit alongside embed-text enrichment.
  ### Generation: a separate, best-effort, self-healing lane

  **Embeddings are a derived recall index, not atlas truth** — a missing or stale vector only means that one doc temporarily leans on lexical/FTS search (which covers it fully). Atlas *structure* being out of sync is the real harm. So embedding generation runs in its own lane, **never inside the blocking sync transaction or the deploy/health gate**. There is **no `build-rag` in CI and no `OPENROUTER_API_KEY` in GitHub secrets** — embeddings are entirely a Railway runtime concern, and the Git-LFS vector baseline retires.

  - **Scoped work queue, not a scan.** `sync:atlas` already computes the changed-doc set from the `content_hash` diff (~10–100 docs/update). That exact set is the reconciler's queue. The *only* full pass is the one-time bge→Qwen3 cutover, where every vector is genuinely from the wrong model.
  - **Background reconciler.** After `/health` is green and the process is serving, a background task embeds queued docs via OpenRouter in small batches with backoff. Failures are logged, not propagated — a doc just stays stale for the next pass. Runs on boot *and* on an interval, so an OpenRouter hiccup self-heals: "1 or 2 off, gradually fixed."
  - **Lazy-on-query = prioritization, never a hot-path embed.** When a result-set doc has `embedding.content_hash ≠ doc.content_hash`, *enqueue/bump* it for async re-embed and serve the response with its stale-but-present vector (or lexical fallback). ⚠️ The check is a cheap hash comparison — **never synchronously call OpenRouter to embed a document inside a query**; that would add seconds and re-couple the hot path. (Embedding the *query* string in the hot path is fine — that's the one fast call semantic search always makes.)
  - **Backstop drain** guarantees convergence: a changed doc that's never queried still heals, because the reconciler drains the known changed set in the background regardless.
  - **Missing-vector tolerance.** Semantic search left-joins `atlas_doc_embeddings`; docs without a current vector simply aren't semantic candidates and hybrid RRF falls back to their lexical hit. No errors, just slightly narrower semantic recall until healed.
  - **Cutover is painless:** on the bge→Qwen3 switch all ~10K are stale, the app boots and serves immediately (lexical-only semantic at first), and the reconciler fills vectors over minutes in the background — no giant blocking boot. ≈ $0.015 one-time.
  - **Observability:** surface a stale-count (docs awaiting embedding) on `/health` detail or in `sync_log`, so "are we caught up on vectors?" is answerable.

  ---

  ## Cost Estimate

  **50 users × 50 queries/day = 75,000 queries/month**

  | Component | Monthly cost |
  |---|---|
  | LLM (Qwen3 32B default) | ~$53 |
  | Railway (Bun service + Postgres w/ pgvector) | ~$15–25 |
  | **Total** | **~$60–75/month** |

  Postgres footprint is small with content offloaded: `atlas_doc_meta` ~5 MB + 10K × 1024d float32 vectors ~42 MB + addresses + history ≈ **40 MB total**. Comfortably inside Railway's starter Postgres tier. Bun process holds ~70–100 MB of in-memory atlas indexes (graph + minisearch + content map).

  ---

  ## Auth Flow (arctic)

  **MVP: GitHub only.** Google OAuth added in v1 — same pattern, just a second provider.

  ```
  User → "Sign in with GitHub"
    GET  /api/auth/github          → redirect to GitHub
    GET  /api/auth/github/callback → arctic verifies, upsert user in Postgres
                                  → set signed JWT cookie (userId, provider, exp)
    redirect → /

  JWT cookie: HTTP-only, SameSite=Lax, signed (CHAT_JWT_SECRET), 7-day expiry
  Session validation: middleware checks cookie on every /api/* request
  Silent reauth: if JWT expires in < 24h, middleware issues a fresh cookie in the
    same response — sliding window, user never sees a re-auth prompt unless
    inactive for the full 7 days. No refresh tokens, no DB entries needed.
  ```

  ---

  ## System Prompt

  Built per-session by querying Postgres (chat history) + reading `entity_type_graph` straight off the in-memory graphology index.
  Mirrors the ask-atlas agent prompt:
  - Atlas doc type taxonomy
  - Entity chain (live from graph — facilitator → executor → prime → docs)
  - `atlas_query` tool guide with all dimensions
  - History explanation section (doc type → significance, group by topic, lead with impact)
  - 5-call budget (advisory — hard `maxIterations` enforced server-side)

  ---

  ## Context Compaction

  Qwen3 32B has a 131K token context window. Compaction triggers automatically at **70% full (~91K tokens)**, checked after each assistant response using `usage.prompt_tokens` from the OpenRouter response.

  **Algorithm (runs between turns, never mid-stream):**
  1. Keep the last 6 messages verbatim (3 user+assistant exchanges — the live tail).
  2. Send everything before the tail to a separate compaction LLM call: *"Summarize this governance research conversation, preserving atlas nodes referenced, key facts established, conclusions reached, and open questions."*
  3. Store the summary + a pointer to the last summarized message in the DB.
  4. Reconstruct future context as: `system prompt → summary block → live tail`.

  **On subsequent compactions**, the summary block itself gets folded into the next summary — the summary stays bounded, sessions are effectively unlimited length.

  **Context reconstruction:**
  ```
  system_prompt
  [if summary exists]:
    { role: 'system', content: '--- Earlier conversation ---\n{summary}\n---' }
  messages WHERE id > summary_upto_id ORDER BY created_at
  ```

  **DB additions to `conversations`:**
  ```sql
  summary          TEXT,      -- compacted summary of messages before summary_upto_id
  summary_upto_id  UUID REFERENCES messages(id)  -- last message included in summary
  ```

  **Cost:** one extra LLM call per compaction (~$0.01–0.02 at Qwen3 32B rates). Compaction happens roughly every 45–90 exchanges at typical message lengths — negligible overhead.

  ---

  ## Build Order

  1. **Provision Railway Postgres + migration runner** — enable `pgvector`; manage schema with a numbered-migration runner + `schema_migrations` tracking table (mirror the one just shipped on the D1 side), *not* raw one-shot `CREATE TABLE`. Initial migration creates the chat + atlas schemas.
  2. **`pnpm sync:atlas`** — writes Postgres tables (`atlas_doc_meta`, `atlas_doc_embeddings` *(structural rows only; vectors come via the reconciler)*, `atlas_addresses`, `atlas_history`) from build artifacts. The in-memory indexes need no publish step — `graph.json` ships committed in the image, and `docs.json` is regenerated from the atlas submodule during Railway's build. Runs at Railway boot (deploy = sync), *not* a GitHub workflow.
  3. **In-memory index loader** — boot-time + `/internal/reload-atlas` rebuild for the graphology graph (from `graph.json`), minisearch FTS (from `docs.json`), and doc content map (from `docs.json`). Atomic swap.
  4. **`atlas_query` tool — mode-routed** (pure, transport-agnostic functions — see Bun service "Tool layer" note). Port `rrfMerge` / shaping / zod schemas from `redlens-mcp/src/index.ts`; rewrite only the data adapters and the graph sub-modes (CTE → graphology):
     - in-memory: `search` lexical (minisearch), `graph` / `enumerate` / `coverage` (graphology), content lookup (doc map)
     - Postgres: `search` semantic (pgvector), `addresses`, `history`
     - hybrid `search`: pgvector + minisearch with RRF merge in JS
  5. **Scaffold Bun service** — routes, Postgres pool, OpenRouter client
  6. **Auth** — arctic OAuth, JWT sessions, users table
  7. **`POST /api/chat`** — agentic loop calling `atlas_query` in-process, SSE streaming, conversation persistence
  8. **Static serving + base-path removal** — Bun serves `dist/` with SPA fallback to `index.html`; move to apex base (`/`). **Deep QA required — see "Base-path removal QA"; the `/redlens` → `/` switch is known to blank-page.**
  9. **Frontend widget** — floating panel, page context injection, conversation list
  10. **Custom domain + Cloudflare** — point CF DNS at Railway, configure cache rules (static = 30d, `/` + `/api/*` + SPA routes = bypass)
  11. **Model benchmarking** — Qwen3 32B (default) vs Gemma 4 26B A4B (if tool use confirmed) on the 13 governance questions (`docs/benchmark-questions.md`)
  12. **Decommission GH Pages** — once `sync:atlas` parity is verified and DNS is cut over. **Keep the CF Worker running** as the MCP endpoint (`ask-atlas` etc. depend on it) — it is *not* decommissioned in MVP. It retires only after the deferred Bun MCP surface lands and consumers repoint (do-if-easy, see Bun service "MCP surface" note).

  Steps 1–4 are the migration; 5–10 are the new app; 11–12 are validation + cleanup. MCP re-expose + CF Worker retirement are post-MVP.

  ---

  ## CI / Workflow Migration

  Nothing is deleted until its replacement is proven. The old GH Pages site and the CF Worker each stay live as fallbacks until the thing that supersedes them is validated. Changes to `.github/workflows/` grouped by lifecycle:

  **Immediate (at cutover start)**
  - **`ci.yml` — KEEP + ADD a Bun-service job.** Existing `lint-and-build` unchanged. New job must do more than `tsc`: (a) `tsc --noEmit` on the Bun source, (b) unit tests on the ported tool layer (RRF + graphology traversals), (c) a **Postgres service container** exercising `sync:atlas` end-to-end against a fresh DB + the migration runner, (d) a `/health` boot smoke test. (c)+(d) catch what's most likely to break.
  - **`atlas-update.yml` — UNCHANGED.** Still rebuilds artifacts → commits to `public/` → opens PR. **No `build-rag` step** — embeddings are a Railway-runtime concern (background reconciler), never built in CI.
  - **`claude.yml`, `claude-code-review.yml`, `processes-autoclose.yml` — UNCHANGED.** Hosting-agnostic GitHub automation.
  - **`cf-pages-preview.yml` — KEEP.** Frontend-only static PR preview. Caveat: the chat widget is non-functional in previews (no `/api/*` backend); it only reviews UI / atlas-reader changes.

  **Parallel-run (the whole migration)**
  - **`deploy.yml` (GitHub Pages) — KEEP as live fallback.** GH Pages serves at `/redlens/`, Railway at the apex `/` — different URLs, zero conflict; both rebuild the frontend on each merge (trivial redundant compute). Railway's own GitHub integration stands up the new app alongside it (push to `main` → build + `sync:atlas && bun server`; the build regenerates the gitignored `docs.json`/`search-index.json` deterministically from the committed atlas submodule and uses the tracked artifacts as-is). **No GH deploy workflow is added** for Railway.

  > **Where did DB sync go for the new app?** Nowhere in GitHub Actions — by design. It moves from a GH workflow to Railway's GitHub integration → Bun boot (`sync:atlas`). A future reader diffing the workflows will look for a replacement; there isn't one.

  **Bridge lifetime (while the CF Worker still serves MCP)**
  - **`deploy-worker.yml` — KEEP.** Still deploys `redlens-mcp` to `workers.dev`, the MCP endpoint `ask-atlas` depends on.
  - **`sync-db.yml` — KEEP.** The CF Worker reads D1 + Vectorize, so this entire parallel sync path (incl. `build-rag` via Workers AI + the Git-LFS vector baseline + `CLOUDFLARE_API_TOKEN`) keeps running until the Worker retires. This is the real, non-obvious cost of the MCP bridge — weigh it against cutting MCP cleanly.

  **Final cutover (Railway parity verified, DNS cut over)**
  - Remove **`deploy.yml`** + decommission GH Pages (= Build Order step 12).

  **Post-worker-retirement (Bun MCP surface replaces the CF Worker), in order**
  1. Delete `deploy-worker.yml`, `sync-db.yml` (and `cf-pages-preview.yml` if static previews are also dropped).
  2. Remove the `worker` job from `ci.yml`.
  3. **Only then** retire `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` — all three CF workflows consume them, so pulling them earlier breaks in-flight runs.

  **Secrets**
  - **Add (Railway env, not GitHub):** `OPENROUTER_API_KEY`, `OPENROUTER_MANAGEMENT_KEY`, `CHAT_JWT_SECRET`, GitHub OAuth client id/secret, `CHAT_MODEL`, `RATE_LIMIT_TOKENS_PER_WINDOW` (`DATABASE_URL` provided by Railway).
  - **Add to GitHub:** nothing — notably **not** `OPENROUTER_API_KEY`, since embeddings don't run in CI.
  - **Keep in GitHub:** `ETHERSCAN_API_KEY`, `ETH_RPC_URL` (used by `atlas-update.yml`), `GITHUB_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`.
  - **Retire last:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (after the CF workflows are deleted).

  ---

  ## Base-path removal QA

  Moving from `/redlens/` to apex `/` is known to produce a blank page. Two independent causes — both must be fixed and verified.

  **Cause 1 — hardcoded router base (primary).** `vite.config.ts` parameterizes the Vite base (`CF_PAGES === "1" ? "/" : "/redlens/"`), so assets load, but `src/main.tsx` hardcodes `<Router base="/redlens">`. At apex, wouter still expects every route under `/redlens` → no route matches → blank page. Fix: derive it from the same source —
  ```tsx
  <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
  ```
  (`"/redlens/"` → `"/redlens"`; `"/"` → `""` = no base.)

  **Cause 2 — stale service worker (hits returning users only).** PWA `scope` / `start_url` / `navigateFallback` derive from `base` (`vite.config.ts`), so a *fresh* visitor is fine. But a returning visitor with the old `/redlens/`-scoped SW installed keeps getting served the stale `navigateFallback: /redlens/index.html` + precached chunks, which no longer match at apex → blank page. `registerType: "prompt"` means it won't auto-update — and the user can't accept the prompt on a blank page. Need a one-time kill-switch SW (self-`unregister()` + `clients.claim()`) deployed under the old `/redlens/` scope, or verified takeover by the new SW.

  **QA checklist (must test as a RETURNING user, not just incognito):**
  - [ ] Router base fix in `src/main.tsx`; every route (`/`, `/atlas/:id`, `/radar/:slug`, `/reports/*`) resolves at apex
  - [ ] Deep-link refresh (load `/radar/foo` directly, hard-refresh) → SPA fallback serves `index.html`, route resolves
  - [ ] `import.meta.env.BASE_URL` fetches resolve (workers: search/atlas/graph; lib: glossary/history/addresses/processes/graph/chainstate) — all 13 callsites return 200, not 404
  - [ ] Old SW migration: visit with a `/redlens/`-scoped SW already installed → confirm clean takeover, no blank page, no stale-chunk `Failed to fetch dynamically imported module` errors
  - [ ] PWA icon, `start_url`, manifest scope all resolve at apex
  - [ ] Hard-navigation + in-app navigation both work (wouter `pushState` links + direct URL entry)
  - [ ] CF cache: confirm `/` and SPA routes bypass cache (a cached `/redlens`-era HTML would reference dead asset paths)

  ---

  ## Rate Limiting

  Small trusted user base → shared global credit pool with per-user token windows.

  **Global pool** — sourced live from OpenRouter: `GET https://openrouter.ai/api/v1/credits` returns `{ total_credits, total_usage }` in dollars. `total_credits` is what was purchased (the pool size); `total_usage` is what OpenRouter says has been spent. No `GLOBAL_TOKEN_LIMIT` env var — the limit is whatever is in the account. Checked before each `/api/chat` request; if `total_usage >= total_credits`, return `429`.

  OpenRouter credits endpoint uses a separate **management API key** (`OPENROUTER_MANAGEMENT_KEY`) — distinct from the `OPENROUTER_API_KEY` used for model calls.

  ⚠️ **Verify before shipping:** confirm whether `total_credits`/`total_usage` are lifetime cumulative or reset periodically (monthly etc.). OpenRouter appears to be a prepaid credit wallet (no reset — you top up and it depletes), but this must be confirmed against the dashboard. **Our local `SUM(cost_usd)` scope must match the same window** — if lifetime, sum all messages ever; if monthly, filter to the current month. Mismatched windows would make the usage UI misleading.

  **Per-user split** — tracked from our own `messages` table via `SUM(cost_usd)`. No conversion needed: `cost_usd` is already in dollars. My spend vs all-other-users spend is a simple group-by query. Note (#8): `cost_usd` backfills asynchronously, so this dollar figure is **display-only and may lag** — it is *not* the hard per-user gate. The hard gate is the token window below, which uses `input_tokens + output_tokens` (known at stream-end, never null).

  **Per-user window** — `RATE_LIMIT_TOKENS_PER_WINDOW` tokens per 180-minute non-rolling window. Window boundaries are fixed clock intervals (00:00, 03:00, 06:00 … UTC), not relative to first request. Tracked from `SUM(input_tokens + output_tokens)` in the current window. When hit, respond: *"Usage limit reached — resets at [time]."*

  **Usage UI** — shown in the expanded chat widget, below the context badge. A row of squares in three fill states (dollar-denominated for global; token-denominated for the per-user window beneath it):

  ```
  Global pool  [■■■▪▪▪□□□□□□□□□□□□□□]  $4.20 / $20.00
                ↑ you  ↑ others  ↑ remaining

  Your window  [■■■■■□□□□□]  32,400 / 50,000 tokens  (resets 03:00 UTC)
  ```

  Fetched from `GET /api/usage` on widget open and after each response. Cached 30s server-side (avoids hammering OpenRouter credits API).

  **`GET /api/usage`** returns:
  ```ts
  {
    global: { spent: number, limit: number },      // dollars, from OpenRouter + our DB
    user:   { spent: number },                     // dollars, from our DB
    window: { tokens: number, limit: number, resetsAt: string }
  }
  ```

  **Env vars:**
  ```
  RATE_LIMIT_TOKENS_PER_WINDOW=50000  # per user per 180-min window
  ```

  ---

  ## Deferred

  - Conversation search
  - Cross-device sync (currently per-browser via server sessions)
  - **Embed-text enrichment** — the embed step currently embeds bare `title + content` (logic ported from `build-rag`'s `buildEmbedText` into the reconciler). Atlas docs are mostly tiny structural fragments (p50 ≈ 30 tokens), which carry thin semantic signal for *any* model. Prepending the ancestor breadcrumb (parent/scope *titles*, never doc_nos — those are editorial churn) would place each leaf in the governance hierarchy and improve recall. Tradeoff: a parent retitle would mark its descendants embedding-stale (rare, and arguably correct). Model-independent; pairs with revisiting the optional Qwen3 query-side instruction prefix.
