# RedLens Atlas Reader — Chatbot Frontend Plan

A frontend-scoped companion to `chatbot-plan.md`. Covers everything needed to build the chat UI — the floating widget, the profile button, and the usage meter — plus enough of the backend to understand what you're integrating with (it is **not** a black box). Database schema, sync, migrations, embeddings, and CI are deliberately omitted; see `chatbot-plan.md` for those.

The chat **backend is already built and verified** (on `main`): GitHub OAuth, the agentic `/api/chat` SSE loop, conversation persistence, and the per-user token rate limit all work end-to-end. What remains is this frontend.

---

## 1. What the backend actually is (so the FE isn't flying blind)

One **Bun service** (Railway) serves both the SPA bundle (`dist/`) and `/api/*` from the same origin — no separate API host, no CORS to worry about for the app's own calls.

On boot it loads the **entire atlas into memory** (~10k documents) as three indexes: a graphology graph (entities + typed edges), a MiniSearch lexical index, and a doc-content map. Postgres holds only vectors (semantic search), addresses, history, and the chat tables.

**`/api/chat` runs an agentic loop**, which is the mental model the UI is built around:

```
your message + page context
   → system prompt (injects the live atlas taxonomy + entity graph)
   → LLM (Qwen3 via OpenRouter)
       ⇅ may call atlas tools (search / get / query / address / describe)
         over the in-memory indexes + Postgres, up to 6 rounds
   → streams the final answer back token-by-token (SSE)
   → persists the conversation + assistant message (tokens, cost, tool calls)
```

The model has the **same 5 tools an MCP client gets** (`atlas_search`, `atlas_get`, `atlas_query`, `atlas_get_address`, `atlas_describe`). The UI doesn't call these directly — the model does, mid-stream — but the widget surfaces them as **tool-call traces** (debug toggle) so a user can see "it searched for X, then read doc Y." Answers cite atlas docs as `[Title](/atlas/<uuid>)` links, which the renderer intercepts for in-app navigation.

That's the whole picture: **a page-aware research agent over the atlas, streamed.** Everything below is how the UI wraps it.

---

## 2. API contract (what the frontend calls)

All same-origin. Auth is a signed **HTTP-only cookie** — JS cannot read it, so auth state always comes from the server (`/api/auth/me`), never from reading a cookie.

### Auth

| Endpoint | Use |
|---|---|
| `GET /api/auth/me` | Called on app boot. `200 → { id, name, avatarUrl, provider, email }` if signed in; `401` if not. Drives all auth-gated UI. |
| `GET /api/auth/github` | Entry point for sign-in. Redirects to GitHub (sets a short-lived CSRF state cookie). Open via popup or full redirect (see §3). |
| `POST /api/auth/signout` | Clears the session cookie. `200 → { ok: true }`. Reset auth state to logged-out. |

> ⚠️ **Backend note for the popup flow:** the OAuth callback currently **redirects to `/`** after setting the cookie — it does **not** `postMessage` + self-close. So the *full-redirect* flow works today (land back on `/`, call `/api/auth/me`). The popup+`postMessage` flow needs a small backend addition (a callback page that posts to `window.opener` and closes). Start with full-redirect; add the popup-close page when polishing.

### Chat — `POST /api/chat` (SSE)

**Request body:**
```ts
{
  message: string,
  conversationId?: string,          // omit → server opens a new conversation
  pageContext?: {                   // see §5; all fields optional
    path?: string,                  // e.g. "/atlas/<uuid>"
    nodeId?: string,                // selected atlas node UUID
    nodeTitle?: string,
    nodeDocNo?: string,
    actorSlug?: string,             // radar actor
    reportName?: string,
  }
}
```

**Response:** `text/event-stream`. Each event is `data: <json>\n\n`, where `<json>` is one of:

```ts
{ type: "meta",        conversationId: string }        // first event — store it for follow-ups
{ type: "token",       text: string }                  // append to the live answer
{ type: "clear" }                                      // DISCARD the live answer buffer (see below)
{ type: "tool_call",   name: string, args: object }    // model invoked a tool (trace)
{ type: "tool_result", name: string, ok: boolean, bytes: number }
{ type: "done",        content: string,                // authoritative final answer
                       usage: { input: number, output: number },
                       generationId: string | null,
                       toolCalls: { name, args, ok, bytes }[] }
{ type: "error",       message: string }               // mid-stream failure
```

**The `clear` event is load-bearing.** Some models emit `<tool_call>` sentinel fragments as *content* during a tool round, before the structured call. The server streams those tokens, then emits `clear` to tell you **reset the live answer buffer**. Contract: accumulate `token` text into a buffer; on every `clear` (and on each new `tool_call`), wipe it; `done.content` is always the clean, authoritative answer. Practically: render the streaming buffer for responsiveness, but trust `done.content` as final.

**Non-200 responses (not SSE — plain JSON):**
- `401 { error: "unauthenticated" }` → trigger sign-in.
- `429 { error: "rate_limited", message, tokensUsed, limit, resetsAt, window }` + `Retry-After` header (seconds). Show `message` (e.g. *"Usage limit reached — 6,124 of 500,000 tokens used this window. Resets at …"*) and disable send until `resetsAt`.
- `400 { error: "empty_message" | "invalid_json" }`.

**Always attach an `AbortController`.** Pass its signal to `fetch`; abort on widget close, new message, or unmount. The server watches the connection and stops the agentic loop on disconnect, so aborting actually saves tokens.

### Usage — `GET /api/usage`

```ts
{ window: { tokens: number, limit: number, exceeded: boolean,
            resetsAt: string /* ISO */, windowMinutes: number } }
```
Per-user token window (default 500k tokens / 120 min, fixed clock buckets). Fetch on widget open and after each `done`. (A global account-wide pool will be added later as `{ global, user, window }` — design the meter to accept more fields.)

---

## 3. Auth (client perspective)

HTTP-only cookie → **server is the source of truth.** On boot, call `/api/auth/me` once; cache the result in app state (React context or a module-level promise). That result gates all auth UI.

**Sign-in:** triggered by a direct user click (profile button or chat submit while logged out).
- **MVP (works today): full redirect** — `window.location = "/api/auth/github"`; after the callback the user lands back on `/`; re-call `/api/auth/me`. To not lose a typed message, see draft persistence (§4).
- **Polish (needs backend popup-close page): popup** — `window.open("/api/auth/github", "auth", "width=600,height=700")`; the callback page `postMessage`s `{ type: "auth_complete" }` to `window.opener` and closes; the widget re-fetches `/api/auth/me` and resumes with the typed text pre-filled. Fallback to full redirect if `window.open` returns `null` (blocked).

**Sign-out:** `POST /api/auth/signout` → reset state to logged-out.

---

## 4. Profile button (top-right header)

Lives in the NavBar, right side.

**Logged-out:** a "Sign in" button / person icon → triggers the same GitHub flow as the chat widget (one consistent entry point — share an `openAuth()` util).

**Logged-in:** circular GitHub avatar (`avatarUrl` from `/api/auth/me`). Click → dropdown:
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

**Preferences sub-panel (v1 — surface existing local-storage settings):**
- Color-scheme toggle (slots in when ready).
- Any existing local-storage UI prefs (tree collapse state, etc.).

**Draft persistence (applies to the widget input).** Mirror the chat input to `localStorage` (`chat-draft`, debounced) on every keystroke; restore on widget open; clear on successful send. The user never loses a typed message across refresh, crash, accidental close, or a full-redirect sign-in.

**Future:** conversation history list moves into this menu.

---

## 5. Floating chat widget

Lives in the `App.tsx` shell — visible on every page.

### States
- **Collapsed** — pill-shaped input bar, bottom-right. Context-aware placeholder: on an atlas node *"Ask about [node title]…"*, elsewhere *"Ask about the Sky Atlas…"*.
- **Expanded** — slides up into a resizable panel. Corner drag handle (bottom-left), **bi-directional** resize. Constraints: max `100vh` × `50vw`; min `320×280`. Size persists across collapse/expand within a session; resets on next visit. Adapt the existing right-panel resize logic (currently horizontal-only) to corner drag.
- **Mobile** — full-screen takeover below Tailwind `md`. No resize handle.

### Page context injection
Each message carries the `pageContext` object (§2) so the model knows what the user is looking at. Resolve it from the current route:
- **Atlas** — selected node UUID + title + doc_no. Straightforward.
- **Radar** — actor slug + entity name. ⚠️ *What else to inject (active tab, visible instances) needs a dedicated design spike — radar surfaces a lot of structured data and the right granularity isn't obvious.*
- **Reports** — report name + selected entity/section.

A **passive context badge** at the top of the expanded panel explains why the model already knows the page (no `@mention` syntax needed):
```
📍 Viewing: Accessibility Scope                    [×]
```

### Behavior
- **Stream** via SSE (§2); render tokens live, honor `clear`, finalize on `done`.
- **AbortController** on every request (close / new message / unmount).
- **Tool-call traces** — render `tool_call` / `tool_result` events as a collapsible "what it looked up" trace. **Off by default**, dev/debug toggle.
- **Conversations** — **MVP: every open starts a new conversation.** It's still persisted server-side (the `meta` event gives you the `conversationId`), but there's no history UI yet. *v1: resume last conversation on open; "New conversation" button; history list + search.*

---

## 6. Rendering

Use `react-markdown` + `remark-gfm`. A custom link component intercepts `/atlas/<uuid>` hrefs for SPA navigation (same pattern as `NodeContent.tsx`) — atlas links from the model open the node in the reader without a reload.

- **Rendered:** streaming markdown — inline code, code blocks, bold/italic, lists, blockquotes, tables, atlas doc links.
- **Not rendered (deferred):** KaTeX/math, inline widgets, interactive tables. The system prompt instructs the model not to emit these.
- **Streaming code-fence fix:** if the accumulated answer has an **odd** number of ` ``` ` fences, append a synthetic closing fence before rendering, remove it on `done`. Prevents the rest of the message collapsing into a code block mid-stream.
- **`clear` handling (§2):** reset the live buffer; never let leaked `<tool_call>` fragments reach the renderer.
- **Atlas quotes:** the model is instructed to quote ≤ 1–2 sentences per doc, always followed by its `[Title](/atlas/<uuid>)` link — so expect short quotes + links, not pasted documents.

---

## 7. Usage meter

Shown in the expanded widget, below the context badge. Driven by `/api/usage` (fetch on open + after each `done`) and by any `429`.

```
Your window  [■■■■■□□□□□]  32,400 / 500,000 tokens  (resets 16:00 UTC)
```
- Fill = `tokens / limit`; reset label from `resetsAt`.
- On `429`, surface the `message` and disable send until `resetsAt`; re-enable via the `Retry-After` countdown or a refetch.
- Design it to later grow a **global pool** row on top (account-wide dollar spend) when that backend lands — `/api/usage` will gain `global` / `user` blocks.

---

## 8. Routing / base path (frontend mounting)

The app already parameterizes its base: `vite.config.ts` builds `base: '/'` on Railway (and `/redlens/` for the GH-Pages fallback), and `src/main.tsx` derives the wouter `<Router base>` from `import.meta.env.BASE_URL`. Any runtime URL (fetches, links, icons) must go through `import.meta.env.BASE_URL` — applies to every new `/api/*` fetch the widget adds. The Bun service serves the SPA with a fallback to `index.html`, so deep links (`/atlas/:id`, `/radar/:slug`) resolve client-side.

*(One returning-user gotcha when the apex cutover happens: a stale `/redlens/`-scoped service worker can blank-page returning visitors — relevant only at final cutover, tracked in `chatbot-plan.md`.)*

---

## 9. Frontend build order

1. **Auth state** — `/api/auth/me` on boot → context/store; `openAuth()` util (full-redirect first).
2. **Profile button** — logged-out/in states, avatar dropdown, sign-out.
3. **Collapsed widget** — pill input, context-aware placeholder, draft persistence.
4. **Expanded panel** — markdown rendering, SSE streaming client (token/clear/done), AbortController.
5. **Page context** — inject `pageContext` per route; context badge (radar = spike).
6. **Tool-call traces** — debug toggle.
7. **Usage meter** — `/api/usage` + `429` handling.
8. **Resize + mobile** — corner drag, full-screen mobile.
9. **Preferences panel** — surface existing local-storage settings.

---

## 10. Deferred (frontend)

- Conversation resume + history list + conversation search (needs history endpoints).
- Cross-device sync (currently per-browser via server session).
- Popup OAuth (needs the backend callback-close page).
- Radar context-injection design spike.
- Global usage pool row in the meter (needs the global-credits backend).
