# Chat System — End to End

> **This document is descriptive: it records how the chat system actually works
> today, and it is the canonical reference for the chat / AI-harness surface.**
> Where anything else disagrees with this doc, this doc wins.
>
> The prescriptive plans that produced this system have been archived to
> [`docs/plans/archive/`](./plans/archive/) — read them for *why* a decision was
> made, never for what the code does now. Active chat plans:
> [`docs/plans/chatbot-readiness-remediation-plan.md`](./plans/chatbot-readiness-remediation-plan.md)
> (open items: shared report builders, upstream Active Data, supplemental
> sources), with its sub-plan
> [`atlas-report-remaining-kinds.md`](./plans/atlas-report-remaining-kinds.md);
> [`docs/plans/chat-class-completeness.md`](./plans/chat-class-completeness.md)
> (search is ranked — superlatives and exhaustive questions need a class listing
> and class-mode `atlas_first_seen`, not top-k);
> [`reference-citations.md`](./plans/reference-citations.md).

An agentic, tool-calling RAG assistant over the Sky Atlas. The model never
answers from memory — every claim must be grounded in Atlas documents it
retrieves via tools, and citations are machine-verified. The entire chat
surface is gated behind `CHAT_ENABLED`; when off, `/api/chat`, `/api/auth/*`,
and `/api/usage` all 404. **`CHAT_ENABLED` is AND-gated by `USERS_ENABLED`** —
setting `CHAT_ENABLED=1` alone does nothing, because chat requires sessions.

**Where the code lives.** Server: `src/server/chat/` (loop, orchestrator,
routing, history, titling, credits), `src/server/chat/tools/` (tool registry),
`src/server/chat/verify/` (the harness), `src/server/retrieval/` (search,
embed text, indexes), `src/server/facts/` (auto-injected knowledge). Client:
`apps/web/src/components/chat/`.

## 1. Frontend (`apps/web/src/components/chat/`)

`ChatWidget` is a floating panel (⌘K/Ctrl-K to open, Esc to close) mounted once
in the app shell, with `float` (corner card) and `anchored` (right column)
placements persisted in localStorage. `useChatStream.send(text, pageContext)`
POSTs `{ message, conversationId, pageContext }` to `/api/chat`, then reads the
response as a raw stream (not `EventSource`, since it's a POST), buffering on
`\n\n` and parsing `data:` SSE frames into typed `ChatEvent`s. A `dispatch()`
reducer mutates the last assistant message per event. Answers render through
`chat/markdown.tsx`'s `AtlasMarkdown`, which shares the atlas reader's LaTeX
pipeline (`apps/web/src/lib/markdownMath.ts`) so a formula quoted verbatim
from a document renders identically in chat and in the reader.

**While a turn is in flight**, the message renders as a stage checklist
(`StageList`) — one row per stage the turn has reached (`recalling`,
`querying`, `synthesizing`, `comparing`, `checking`), populated live off
`status`/`facts`/`tool_call`/`tool_result`/`reasoning` events. Each row is its
own disclosure: clicking it (there is no panel-wide toggle) expands that
step's working content — facts recalled, tool calls with their results, the
model's reasoning trace and live token draft, verification findings — under
its label, and a second click collapses it again; a row with no working
content to show (nothing recalled/queried/etc. for that stage) renders
without the disclosure affordance at all. The answer itself appears only on
`answer_final` (the orchestrator's generation-end signal, §6/§8), all at once
and upright — the verify badge, not a text style, is the "unverified" signal
(it used to render italic until the badge resolved, and the flip to upright
read as the answer jumping). When it lands, the thread shows it from its
first line (`useStickToBottom`'s `showFrom`) instead of carrying the reader to
its last, and stops following until they scroll. The checklist is split
around the answer: `recalling`/`querying`/`synthesizing` rows render above
it, `comparing`/`checking` rows below it (`POST_ANSWER_STAGES`, Message.tsx),
so the answer sits directly under the Synthesizing row where the reader was
watching it form, and the verification rows arriving never push it. A live
turn's checklist never folds — the final render must not rearrange what is on
screen. Only a finished turn that *mounts* finished (a reopened panel, a
loaded thread) starts as one summary line per list that re-expands on click,
so a history of turns doesn't read as a wall of stage rows — and every row is
`data-state="done"` once the turn is over
(no row keeps pulsing as "active" after the turn has ended, even the last
one, whether the reader re-expands it or the turn stopped/failed).

Preferences (`usePrefs`): `reduceMotion`, plus placement. The old `details`
header toggle, the `traces` preference, and the standalone `ToolTrace`
component are gone — a stage row's working content opens per-row now (see
above), and tool calls render inside their stage row.

The client `ChatEvent` union in `api.ts` mirrors the server's `HarnessEvent` in
`chat-orchestrator.ts` — **they must stay in sync**. The rule that keeps them
honest: *every input to `CheckReport.failed` must reach the client* — arrays and
booleans alike. Each one can be a turn's only finding, and a hard failure the
badge can't name renders a red chip that says the answer failed and then can't
say why. Three (`paramMismatches`, `ungroundedCitationValues`, `lengthCapped`)
were missing until 2026-08-21; when adding a fourth, wire it through to
`VerifyBadge`'s `issues` count in the same change. Supporting surfaces:
`VerifyBadge` (harness verdict), `ReasoningBlock` (the model's thinking trace,
open by default and height-capped), `SupersededAnswer` (a draft set aside for a
tool round, kept dimmed rather than deleted), `StageList` (the stage
checklist), `Sources`, `LimitsMeter` + `ContextPie` (usage and context size),
`RateLimitNote`, `ProfileButton` / `SignInButtons` (auth), `usePrefs`
(display + placement preferences), `resume.ts` (conversation resume).

## 2. Server lifecycle (`src/server/chat/chat.ts`)

`handleChat` (mounted at `POST /api/chat`) runs in order:

1. **Auth** — `getSessionUser` (JWT cookie session); 401 if none.
2. **Validation** — reject empty and oversized messages (`MAX_MESSAGE_BYTES`).
3. **Concurrency gate** — per-user max simultaneous in-flight turns
   (`chat/concurrency.ts`, in-memory `Map<userId, count>` — correct only
   because this service is a `replicas=1` singleton; `CHAT_MAX_CONCURRENT_PER_USER`,
   default 3; 429 `too_many_concurrent` past the cap). Checked first — no
   DB/network round trip — so an over-cap caller fails fast instead of paying
   for the token-window query below. A slot acquired here is released exactly
   once, on every path: each 429/404 branch below, an outer `finally` covering
   any throw between acquire and the SSE stream's construction (a DB blip in
   the token-window query, conversation resolution, or the message
   insert/history reload would otherwise leak it silently), and the stream's
   own `finally` once it owns the slot.
4. **Rate-limit + commons gate** (parallel) — per-user rolling token window
   (`RATE_LIMIT_TOKENS_PER_WINDOW`, default 750,000 tokens /
   `RATE_LIMIT_WINDOW_MINUTES`, default 120; 429 with `Retry-After` if
   exceeded). Named GitHub logins get a higher ceiling:
   `RATE_LIMIT_BOOST_LOGINS` (comma-separated, case-insensitive) →
   `RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED` (default 3,000,000), an explicit
   token value rather than a multiplier so an on-call reader can tell someone's
   limit straight off the env. The login is read from `users.github_login`
   (scoped `provider = 'github'`, never from the JWT — a 7-day cookie would go
   stale, and auth.ts re-upserts the login each OAuth precisely because logins
   drift), concurrently with the usage SUM, and skipped entirely when the
   allowlist is empty. A failed lookup degrades to the base limit, never to
   boosted and the account-wide OpenRouter credit pool (`fetchCommons` in
   `credits.ts`). The commons gate **fails open**: `null` (key unset or credits
   API hiccup) never blocks chat; only a real `remaining <= 0` pauses chat for
   everyone (429 `commons_exhausted`).
5. **Resolve conversation** — verify ownership of an existing `conversationId`
   or `INSERT` a new `conversations` row; 404 `conversation_not_found` if the
   id isn't the caller's.
6. **Persist the user message** before streaming, then reload full history.
7. **Build the model input** — system prompt, windowed history, facts prefetch.
8. **Model tier routing** — `routeTier` + `resolveTierModels`.
9. **SSE stream** — emit `meta`, then run the harness, forwarding every event
   as-is, `data: {json}\n\n` (§8 — there is one delivery shape, not a mode
   switch).
10. **Persist the assistant message** *after* the stream completes — never
    partial; skipped on abort. Harness rows go to `message_checks`.
11. **Post-response work** — conversation titling (`title.ts`) fires
    fire-and-forget after the SSE response closes, so its budget
    (`CHAT_TITLE_TIMEOUT_MS`, default 20s) costs the user no latency. It
    re-fires at turns 4 and 10; a conversation ending at turns 1–3 keeps its
    truncated `slice(0, 60)` seed title.
12. **Observability** — a per-turn PostHog trace keyed by conversation id
    (semi-anonymous), not by user. `CHAT_CAPTURE_CONTENT` (on by default)
    controls whether raw prompt/response text rides the `$ai_generation` event
    or only token counts/latency/cost.

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
`CHAT_MODEL_STRONG`, so swapping the strong tier doesn't silently change what
format an unmeasured model gets asked for. The pipeline accepts both from every
model regardless; see `docs/plans/reference-citations.md`. History is windowed
to a hard char budget (`chat-history.ts`).

The prompt also carries a **"Drafting messages to a third party"** section:
composing a message, email, or forum reply about the atlas for someone else is
an expected request, and the draft carries the same citations a direct answer
would. It exists mostly to head off two format traps that would otherwise fail
the machine checks — a draft wrapped in a `>` blockquote is read as verbatim
atlas text and checked against the sources (so it fails as a fabricated quote),
and a draft in a code fence renders its citations as literal markup. Plain
prose under a heading is the shape asked for, with `export_findings`
(`format: "markdown"`, which absolutizes `/atlas/<uuid>` links) offered as the
way to get the draft out of the app.

**Facts prefetch (`src/server/facts/`).** A deterministic pre-lookup runs before
the model's first request and injects whatever fires as **one synthetic tool
round** named `atlas_prefetch` (`registry.ts`'s `factRound`). Riding a real tool
round is load-bearing: the verifier, quote-grounding, and citation checks consume
injected knowledge as ordinary turn evidence with zero special-casing, because
`evidenceFromTranscript` walks tool messages generically. Facts that can fire:

- **Glossary + entity rows** (`prefetch.ts`) — definitional questions answer in
  one pass instead of burning a tool round.
- **Role dossiers** (`facts/roles.ts`) — for a defined role the question names
  (a Definitions entry ending in Facilitator / GovOps / Agent / Delegate /
  Conserver / Council / Foundation; alias- and plural-tolerant, including the
  atlas's own interior-word abbreviation "Operational Facilitator"): its
  definition, the role family's Article, every document titled with the role,
  and any "The <role> for X is Y" assignment. Exists because ranked search never
  surfaced A.1.7.1 for the example question about facilitator rewards.
- **Concept censuses** (`concepts-prefetch.ts`) — routed 1-of-N by similarity.
- **App features** (`features.ts`) — product questions about the reader itself.

Two lanes decide firing. The deterministic lane matches the message against the
glossary and entity roster. The **similarity lane** (`facts/similarity.ts`) is an
on-device embedding (~2ms, no network) that catches product questions phrased in
words no regex anticipates ("show me around", "what should I try first?"). It is
a *second* lane only — it never overrides the deterministic one, and it is
suppressed when the question names a real atlas subject. Its margin
(`CHAT_FACT_SIMILARITY_MARGIN`, default `-0.05`) is deliberately permissive:
over-injecting costs ~2k discarded tokens a large model can ignore, while
under-injecting can lose the answer. `CHAT_PREFETCH=0` kills every fact at once.

**Tier routing** (`model-router.ts`) classifies the message by regex signals into
FAST/DEFAULT/STRONG model chains — free, no pre-flight LLM call; with no env
config it's a no-op. STRONG fires on comparison, rule interaction, implications,
governance-risk wording, **enumeration** ("all of the X", or "all … that/which/who"
within 90 chars), **synthesis** (generate / compile / enumerate / inventory /
timeline / trends), ≥2 question marks, or >350 chars. The last two signal groups
are sized to the 2026-08-21 bakeoff: every question the strong tier measurably
won was a corpus-wide enumeration or generation (§6.5), and requiring a
determiner after "all" is what keeps the idioms ("is that all?", "all good") on
the cheap path. Over the 14 hard bakeoff queries this routes 11 strong and 0
fast, covering all six of the measured wins; the three left on DEFAULT are the
ones where the two models tied.

Those regexes are high-precision and low-recall, and the 11-of-14 is *in-sample*
— the patterns were fitted to those questions. Against 28 natural paraphrases
written to avoid every trigger ("map out the entities the atlas recognizes"),
they score **0**. So a **second lane** (`chat/complexity.ts`'s `looksComplex`)
scores the question against enumeration/synthesis prototypes with the same
on-device embedding the facts and census lanes use (~3ms, no network), minus a
"one named subject" negative set, and routes STRONG above the margin
(`CHAT_COMPLEXITY_SIMILARITY_MARGIN`, default 0.25). It runs *after* the
deterministic signals (so a regex keeps its own `reason`) but *before* the fast
check, since whole-corpus questions are often short and lookup-shaped. It gets
its own `reason` — `"similarity"` — so PostHog's `chat_route_reason` meters the
lane's fire rate with no new instrumentation.

Unlike every other consumer of the embedding, this lane does **not** suppress on
`namesAtlasSubject`. That suppressor is what holds the features lane to 1 false
fire in 184, but here it stands down on 18 of 28 genuine positives: whole-corpus
questions are *made of* atlas vocabulary. Naming a subject tells you a question
isn't about the app; it tells you nothing about whether it's complex. Measured
(`pnpm eval:complexity`, 180 questions): the lane adds 13 true positives for 1
false fire over regex alone. Zero false fires is unreachable here — "what are
the features of <doc title>?" out-scores every true positive — which is why the
margin is set on the marginal trade rather than a clean separation, and why the
cost asymmetry is the justification: a false fire buys a better *and* faster
model, so it costs tokens, never correctness.

## 4. The agentic loop (`chat-loop.ts`)

`runChat` is a pure async generator (the LLM is injected as `ChatStream`, so it
unit-tests with no network/DB). Each iteration (max `CHAT_MAX_ITERATIONS`,
default **4**; strong-tier turns use `CHAT_MAX_ITERATIONS_STRONG`, default **6**,
and never below the default cap) streams a completion and accumulates content, tool-call deltas,
`finish_reason`, and usage (accumulated across rounds — load-bearing for rate
limiting). If any tool-call deltas accumulated, it emits `clear`, executes all
calls in parallel via `execToolDetailed`, appends results, and continues;
otherwise the content is the final answer and it emits `done`.

The round is keyed on the accumulated calls rather than `finish_reason == "tool_calls"`,
because providers differ on which reason they report alongside tool calls — but a
`"length"` finish still falls through to the answer path, since its call arguments
were cut off mid-JSON and must not be executed. The last allowed iteration flips
`tool_choice: "none"` and injects a final-turn instruction so no dangling tool
round is left open. A **compose guard** (`composeFinal`) buys one no-tools
answer-or-abstain attempt whenever a round ends with empty content, so loop
exhaustion can't ship an empty answer.

Why 4 and not the original 6: every round replays the full context, so round
count — not token count — is the dominant latency driver (a 30-turn in-repo eval
measured median 82s, max 229s). The old default predates the curated
`atlas_report_*` one-call rollups: questions that used to need four narrow tool
calls now need one, so the extra rounds bought latency rather than evidence.

## 5. Tools & retrieval (`chat/tools/tool-registry.ts`, `retrieval/search.ts`)

Atlas tools live in `ATLAS_TOOLS` (`tools/tool-registry.ts`) and are shared by
chat (`tools/llm-tools.ts`, which converts each zod shape to JSON Schema) and
the MCP server (`mcp.ts`). A second registry, `EXTERNAL_TOOLS`, is registered
on MCP only (`external_msc`); chat instead exposes `ask_external_msc` and
intercepts it to run an isolated sub-agent. The two families must never be
mixed as evidence:

| Group | Tools |
|---|---|
| Search / fetch | `atlas_search`, `atlas_query`, `atlas_get`, `atlas_filter`, `atlas_describe` |
| Graph | `atlas_entity`, `atlas_entities`, `atlas_edges`, `atlas_neighbors`, `atlas_traverse` |
| Params | `atlas_params`, `atlas_entity_params` |
| Addresses | `atlas_get_address` |
| History | `atlas_history`, `atlas_history_stats`, `atlas_recent_changes`, `atlas_changed_between`, `atlas_first_seen`, `atlas_pr` |
| Curated reports | `atlas_report_multisigs`, `atlas_report_primitive_matrix`, `atlas_report_rewards`, `atlas_report_active_data`, `atlas_report_facilitator_responsibilities`, `atlas_report_govops_responsibilities`, `atlas_report_stale_dates`, `atlas_report_processes`, `atlas_report_oea_assessment`, `atlas_report_risk_rules`, `atlas_report_addresses` |
| Output | `export_findings` (chat-only; emits the `export` SSE event) |
| External (not Atlas) | `external_msc` (MCP) and `ask_external_msc` (chat-only sub-agent). Curated Monthly Settlement Cycle views from Soter Labs workbooks + Sky Forum permalinks. Views: `month`/`series`/`venues` are per-prime and **require** `prime` (their errors return `available_primes` so a wrong guess self-corrects rather than reading as "no data"); `compare` ranks primes for one month; `aggregate` is the cross-prime, multi-month roll-up (ecosystem + per-prime totals, top venues across every prime); `terms` needs nothing. `aggregate` computes supply-side revenue as `prime_agent_revenue − cof` per prime — never `Σ` per-venue `Profit to Grove`, which drops non-venue revenue and spread reimbursement (a $7.29M gap, all Spark) — nests `cof`/`sde` under `to_sky` rather than beside it, treats `value_eom` as a stock (latest, not summed), and returns a `foot_delta` that re-checks the three-way identity. See `.claude/skills/settlement-reports/SKILL.md`. Tool results carry `source_class: "external"`; the verifier ignores them for Atlas quote-grounding and requires the non-Atlas disclaimer. |

`atlas_query`, `atlas_entities`, and `atlas_params` take their free-text search
argument as `query`; `q` still works but is a deprecated alias kept for
backward compatibility, not the documented name.

Search is **hybrid RAG**: a lexical leg (in-memory MiniSearch / BM25, boosting
title, doc_no, and type) and a semantic leg (query embedded, then pgvector
cosine search over `atlas_doc_embeddings` with a relevance floor, degrading to
lexical-only on embed timeout), merged via Reciprocal Rank Fusion (`RRF_K = 60`).

Every tool result is budget-capped. Two budgets exist deliberately
(`output-budget.ts`): `MCP_MAX_RESULT_CHARS` is the larger client-facing budget
for external MCP clients, and `CHAT_TOOL_RESULT_MAX_CHARS` (default **30k**) is
the smaller chat transport budget that keeps one broad tool call from eating the
live chat context. `fitToBudget` greedily keeps items under the byte budget,
always keeps at least one item (a lone oversized item beats an empty result),
and reports `truncated` so the caller pages or narrows instead of blowing up.

## 6. Reliability harness (`chat-orchestrator.ts`, `chat/verify/`)

`runVerifiedChat` wraps the loop and is what the SSE route iterates. Every stage
degrades gracefully — harness flakiness never breaks a turn — and
`transcript`/`checksMeta` are internal, stripped by `sanitizeDone` before any
event reaches a client (test-asserted).

1. **Conversationalist pass** — runs `runChat`, forwarding token/tool/status
   events (through the streaming citation gate, §7) but holding back `done`.
2. **Incremental deterministic checks** (`verify/incremental.ts`) — as the
   answer streams, each completed paragraph is checked against the evidence
   retrieved so far (citation validity, doc numbers, quotes, addresses, cited
   values, parameter values, MSC-as-atlas) and a `paragraph_check` event
   carries its findings; the full-text pass after `done` remains the
   authority (it alone owns completeness, the external disclaimer and the
   length cap). Reveal timing is unchanged; this is the substrate for the
   per-paragraph model audit.
3. **Deterministic checks** — `expandReferenceLinks` normalizes reference-style
   citations into the canonical inline shape, `repairCitations` fixes or strips
   Atlas links, `repairIdentifierLeaks` promotes or deletes leaked slugs, then
   `runDeterministicChecks` validates UUIDs, doc_nos, quotes, addresses,
   **parameter values**, and **class completeness** (superlative / exhaustive
   questions must have listed the class via `atlas_filter` or class-mode
   `atlas_first_seen`; hedging “among those queried” still fails) against the
   live indexes. Evidence is split by provenance first: quote- and value-grounding
   read **atlas** tool results only, so a forum sentence can never ground an
   “the atlas says” quote. When the turn used `ask_external_msc`, two extra hard
   checks apply — the answer must repeat the non-Atlas disclaimer, and a figure
   that is absent from the doc it cites but present in the MSC brief is a
   misattribution. That second check is scoped per value, not by citation shape:
   `[10,000,000 USDS](/atlas/…)` is how the system prompt asks for a genuine
   atlas figure, so a numeric citation grounded in its own doc always passes.
   `tools/export-verify.ts` runs the same split and the same two checks over
   **exported files**, which outlive the conversation.
4. **Refutation-only verifier** (if `CHAT_VERIFIER_MODEL` set) — see below.

All harness activity is recorded to `message_checks`, one row per activity
(`round_checks`, `verify`, `smalltalk_judge`), each with its own `generation_id`
feeding the async cost backfill. Harness tokens count against the same per-user
rate-limit window, so the harness can't spend invisibly.

### 6.1 The refutation-only verifier (`verify/sliced-verifier.ts`, `verify/verifier-slices.ts`)

Since **2026-09-10 the verifier no longer scores what the answer gets right — it
only lists what the retrieved evidence CONTRADICTS.** Rewrites are gone; the
verifier never rewrites an answer, it only reports findings on it. The old
single-prompt `runVerifier` and the earlier `claims`/`figures`/`sets`/`overreach`
four-slice split are both retired — `pnpm eval:verifier` grades the current
design directly, there is no legacy fallback to keep grading.

Two narrow auditors run, each a JSON-mode, temp-0 call:

- **`refute`** — lists only statements the answer makes that the retrieved
  evidence contradicts, each with a quoted evidence span and a reason. It never
  lists what the answer gets right — there is no `supported` verdict any more,
  because a wrongly-asserted "supported" once passed a real defect straight
  through (the single verifier blessed `"Spark is a Pioneer"` off adjacent
  scaffold boilerplate). Refutation-only removes that failure mode by removing
  the claim it has to make. **Since 2026-09-10 this runs PER PARAGRAPH by
  default** (`CHAT_REFUTE_MODE=paragraph`) — see below — rather than once over
  the finished answer.
- **`overreach`** — unchanged: flags an answer that issues a ruling or verdict
  instead of reporting what the atlas says. Always runs once over the whole
  answer, in both refute modes — stance is a whole-answer property, not a
  per-paragraph one.

**The load-bearing idea is still "show your work," enforced in code, not the
prompt.** Every `refute` finding's evidence span is re-checked against the
actual evidence text; a span that isn't really there is **DISCARDED**, never
downgraded to a lesser status — refutation-only has no lesser status to
downgrade to. A finding that survives validation becomes a **candidate**.
Statements the auditor could not locate in evidence at all go to `notFound`
(capped at 5), which is informational only and never affects `overall`.

**`confirm` is a second, independent auditor, and it is conditional.** It runs
only when at least one candidate survived code validation, so a clean answer —
the common case — pays no extra model call. It reviews each candidate on its
own and either agrees (the candidate becomes an agreed `contradiction`) or
doesn't (it stays a `candidate`, unpromoted). Nothing ships as a contradiction
on one auditor's word alone.

`overall` is computed **in code** from the merged result — the model can never
upgrade a deterministic failure, and a candidate cannot become a contradiction
without `confirm`'s agreement. **The confirm gate is a HARD gate**: a candidate
the second judge did not agree with must never reach the reader — it drops out
of `overall`, the `verify_result` wire event, and the badge entirely, and
survives only inside the full `Verdict` persisted to `message_checks.verdict`,
where it is the confirm gate's calibration record and nothing else reads it:

- a deterministic hard failure (`checks.failed`) ⇒ `fail`, independent of the
  model auditors
- no verdict at all (harness degraded before producing one) ⇒ `unverified`
- any agreed **contradiction** ⇒ `fail`
- the confirm gate RAN but never parsed (timeout/unparseable/throw) while a
  candidate was on the table ⇒ `unverified` — `runConfirm` returns
  `agreed: ∅` on both an outage and a genuine "no, none of these", so
  `Verdict.confirm.parsed` is what tells them apart; without it an outage
  silently reads as the clean pass the second auditor never actually granted
- `rulingIssued` (from `overreach`) ⇒ `warn`
- the refute backbone never parsed and nothing else is wrong ⇒ `unverified`
- otherwise `pass`

An unagreed candidate does not appear anywhere in this list — it is not noise
worth a `warn`, it is a rejected candidate, and rejected candidates are silent.
A confirm-outage candidate is different: it is not rejected, it was simply
never looked at, which is why it gets its own `unverified` rung instead of
falling into "unagreed."

Per-slice model overrides go through
`CHAT_VERIFIER_SLICE_MODELS="refute=m1,overreach=m2,confirm=m3"`; unnamed slices
fall back to `CHAT_VERIFIER_MODEL`. Model choice (gemma-4) stays the default
pending a re-targeted `pnpm eval:slices` against the new three-auditor shape —
see §12.

**Per-paragraph refutation is the default (`CHAT_REFUTE_MODE=paragraph`,
`verify/paragraph-refute.ts`).** Instead of one `refute` call over the
finished answer, `chat-orchestrator.ts` submits each paragraph to a
`createParagraphRefuter` as it closes during streaming (the same
`verify/paragraphs.ts` segmentation the deterministic `paragraph_check` pass
already uses) — a `paragraph_refute` SSE event lands per paragraph, either
mid-stream (when the call lands in time) or in one flush right before
`verify_result` for whatever is still outstanding. This is both a recall lever
(reading one paragraph at a time catches contradictions a whole-answer read
stays silent on — measured on the eval corpus, §12) and a latency lever (the
verdict is mostly ready by generation end instead of one more whole-answer
round trip after it). Concurrency is capped (`CHAT_REFUTE_CONCURRENCY`,
default 3) via a simple semaphore; paragraphs at or beyond
`CHAT_REFUTE_MAX_PARAGRAPHS` (default 8) are concatenated into ONE extra call
at flush time, keyed by the first overflowing paragraph's index — every call
carries the full evidence set, so call count rather than paragraph count is
what scales input tokens. A `tool_call` or `clear` — the draft being set aside
— resets the refuter to a new burst; a call still in flight from the old burst
writes nothing when it lands (checked at land time via an integer burst tag),
so a stale paragraph's contradiction can never leak into the shipped verdict.
`refuteParsed` on the merged `Verdict` now means "every paragraph of the FINAL
burst parsed" — a single unparsed or timed-out paragraph flips it `false`
(degrading `overall` to `unverified` unless something else already agreed to a
contradiction), the same honest rule the whole-answer mode used for its one
call. `Verdict.paragraphs` (`{count, parsed, candidates, discarded, timedOut}`)
is the calibration record. `overreach` and the conditional `confirm` call are
unaffected — `confirm` still runs once over every candidate merged across
paragraphs plus any absence-contract candidate. Set `CHAT_REFUTE_MODE=answer`
to fall back to the pre-2026-09 one-call-over-the-finished-answer behavior;
`pnpm eval:verifier --mode paragraph|answer` (§12) grades either.

### 6.2 The absence contract (`verify/absence.ts`)

An absence claim ("the atlas does not specify which chains") used to need
special handling because there is no evidence span to quote for something *not*
being there. Under the refutation-only design it needs less: the parameter-table
refutation for an absence-shaped statement is just an ordinary `refute` finding
like any other — it requires the parameter's owner to be named in the same
sentence (the same precision bar as §6.3), and it goes through the same
`confirm` gate before it can ship as an agreed contradiction. There is no more
three-outcome REFUTED/GROUNDED/UNVERIFIED split: refutation-only only ever
asserts a contradiction (candidate → confirmed) or says nothing about the
statement (`notFound` or silence) — it no longer tries to prove a gap is
genuine, only to catch a false one.

The originating call's raw `args` are load-bearing here: an empty search envelope
(`{"count":0,"results":[]}`) carries no words of its own, so the query is the only
record of *what* was searched for — the only way to tell "nothing found for X"
from "nothing found for something else entirely."

### 6.25 Class completeness (`verify/completeness.ts`)

A superlative or exhaustive question (`oldest` / `all` / `how many`) answered
from ranked search is the 2026-08-24 incident: the extreme is often *not* in
BM25 top-k, and hedging “among those queried” left the claim-table verifier
nothing to contradict. `auditCompleteness` is a three-outcome contract on
**which tools ran**, not on quoting:

- **GROUNDED** — this turn includes class-mode `atlas_first_seen` (`class_total`)
  or an `atlas_filter` listing with `has_more` and `truncated` both false. An
  untruncated `atlas_report_*` result (`truncated` false, numeric `total`) also
  satisfies class grounding — the curated reports are whole-atlas rollups, so
  their `total` is as complete a count as a class-mode listing.
- **REFUTED** — that listing/extremum disagrees with a claimed count or winner.
- **UNVERIFIED** — otherwise, including ids-mode `atlas_first_seen` on a search
  batch. Hard-fails the turn (unlike absence’s unverified warn).

`atlas_filter` now matches exact `title` / `title_prefix`, collects the whole
class, sorts by `doc_no`, then pages `{ total, count, offset, has_more }`.
`atlas_first_seen` keeps ids-mode `{ results }` and adds XOR class mode.

### 6.3 Parameter mismatch — a hard deterministic fail (`verify/param-checks.ts`)

The one deterministic check that consults the derived parameter table
(`src/lib/paramIndex.ts`) rather than only this turn's evidence, and the largest
single check in the harness. It hard-fails when the answer states a **wrong
number for a known atlas parameter**, with the parameter's name and (if
disambiguating) its owner both present in the same sentence. Precision over
recall throughout: generic single tokens (`max`, `cut`, `tail`, `step`) are
excluded as too likely to be ordinary English, and ambiguous title/owner matches
are gated out — refuting is hard-failure-adjacent, so it needs a high precision
bar. `findParamsMentioned` / `formatParamValue` are also consumed directly by the
absence contract.

### 6.4 Small-talk bypass (`verify/smalltalk.ts`)

Auditing a greeting is pure cost. The bypass has three conditions, and is
**fail-closed at every one** — timeout, error, or unparseable JSON all return
`smalltalk: false`, which keeps the full audit:

1. **Answer-side, deterministic** — `isUncheckableAnswer`: the reply is under
   `SMALLTALK_MAX_CHARS` (600) and contains no groundable marker at all. Every
   pattern is deliberately loose — doc_no shapes, UUID fragments, `/atlas/`
   links, any markdown link, bare autolinks, reference labels, EVM addresses,
   **any digit**, braces/backticks. A zero-tool answer that cites or quantifies
   is exactly the hallucination case the verifier exists for.
2. **Question-side, model** — the deterministic predicate can't tell "thanks!"
   from "is the fee governance-controlled?" answered with a marker-free "Yes."
   So one tiny classification call on the user message asks: does it expect
   factual content? Runs **concurrently** with the conversationalist (first user
   message of a conversation only, and only when the message itself is
   marker-free), so the ruling resolves before the answer finishes streaming.
3. `CHAT_SMALLTALK_JUDGE_MODEL` must be set — default
   `google/gemma-4-26b-a4b-it`, the 2026-08-13 bakeoff winner (100% on a 42-case
   set, 0 dangerous errors, p50 722ms). Setting it empty disables the bypass
   outright: no judge, no skip, every turn audits.

### Deferred (2026-09-10)

One follow-up the refutation-only overhaul surfaced but did not build:

- **Per-paragraph incremental refutation — DONE (2026-09-10, both halves).**
  The deterministic half (`verify/incremental.ts`: paragraph segmentation on
  the token stream, never splitting inside a fenced code block; reference-style
  link definitions collected rather than checked as prose; a `paragraph_check`
  event carrying that paragraph's deterministic findings) now has a model half:
  `verify/paragraph-refute.ts` runs the `refute` slice per paragraph as it
  closes, by default (`CHAT_REFUTE_MODE=paragraph` — see §6.1), instead of once
  over the finished answer. `pnpm eval:verifier --mode paragraph|answer` (§12)
  grades either mode against the same corpus, so measure with that rather than
  by feel before adjusting `CHAT_REFUTE_CONCURRENCY` /
  `CHAT_REFUTE_MAX_PARAGRAPHS`.
- **Prior-turn tool evidence is never replayed to the answerer.** `chat.ts`
  replays only `{role, content}` for history, so the model that writes a
  follow-up answer never sees this turn's or earlier turns' raw tool results —
  only `priorTurnsEvidence` hands the *verifier* a summary of earlier answers
  (§6.1's `verifier.ts`) as `[E-prev]`. The system prompt tells the model that
  atlas material already in the conversation counts as grounding, which is
  true for the verifier's evidence but not for what the answerer itself can
  see when composing a follow-up — it re-retrieves instead. Left as a
  separate decision: whether the answerer should get its own prior-tool-result
  replay, and at what budget cost.

## 7. Guard rails (pure code, no model in the loop)

Deterministic passes that fix or stop specific failure modes before they reach
the user. All are unit-tested and cost nothing.

| Module | What it prevents |
|---|---|
| `verify/citation-repair.ts` | Models can't reliably transcribe 36-char UUIDs out of long tool results, so link targets are never trusted: every `/atlas/` link is validated in code, invalid targets are re-resolved from what was actually retrieved this turn (near-miss uuid, doc_no href, truncated uuid, title match), and anything unrepairable is de-linkified so a dead link can never ship, and a link whose text is the uuid itself is retitled to the document's title (`displayText`, shared with the streaming gate). A stripped link is recorded on the `round_checks` row but is **not** a failure — the checks judge the text the reader sees, and the reader saw prose, not a bad link (a 2026-09-10 red badge named a doc that appeared nowhere in the shipped answer; this is why). |
| `verify/stream-link-gate.ts` | The post-answer pass is the authority, but on its own a fabricated link is *visible* until `done.content` replaces it. This gate holds token text from `[` until the link closes (links are short — imperceptible), applies the **same** `LinkJudge`, and emits the repaired form, so the stream and `done.content` agree and nothing flashes wrong. Non-links flush raw past a 400-char cap. |
| `verify/definition-block-gate.ts` | Reference-style answers open with a `[label]: /atlas/<uuid>` definition block — exactly the UUIDs a small model garbles. Buffers that block, repairs the whole citation table once, releases it, then streams prose through the ordinary inline gate. Anything that isn't a top definition block degrades to the plain inline gate. |
| `verify/citation-normalize.ts` | The entire checking layer keys on the inline `[text](/atlas/<uuid>)` shape. One pure, idempotent pass expands reference-style links into it (and repairs two malformed shapes measured in the model bakeoff). Inline-only answers come back byte-identical. |
| `verify/identifier-leak.ts` | Models paste internal handles into prose as pseudo-citations (`(Slug: grove-freezer-multisig)`) — it reads like a link and resolves to nothing. A leaked handle resolving to a doc **retrieved this turn** becomes a real citation; anything else is deleted with its separator. The evidence gate is deliberate: linking a doc the model never retrieved would assert grounding it never established. |
| `repetition-guard.ts` | Answer streams that collapse into repetition (`"aaaa…"`, `"the same as the same as…"`). Pure character- and phrase-level check, tuned against observed 2026-08-06 degenerations; thresholds stay high enough that normal prose and short lists don't trip it. |
| `output-budget.ts` | A single 300–600KB tool response overflowing the assistant that called it (observed on `atlas_entity` / `atlas_entity_params` for Prime Agents). See §5. |

## 8. Delivery and the stage tree

There is one delivery mode, not a mode switch. The SSE route (`chat.ts`)
forwards every event the harness yields, unchanged, as `data: {json}\n\n` —
`resolveDeliveryMode`/`ChatBody.delivery`/`CHAT_DELIVERY_MODE` are gone. The
client always renders the in-flight turn as a stage checklist and reveals the
answer once (§1), rather than the server picking between two client shapes.

**Stage production is the orchestrator's job**, not the route's:

- `recalling` — fires in `chat.ts` before the harness runs, when a fact fired
  (§3's facts prefetch).
- `querying` — fires per tool call, in the conversationalist pass
  (`runVerifiedChat`, `chat-orchestrator.ts`).
- `synthesizing` — fires once per **generation burst** (the run of tokens
  since the last `tool_call`, or since the stream started), right before that
  burst's first `token`. A `tool_call` resets the burst, so a turn that calls
  a tool and then answers gets two `synthesizing` events — one for any
  pre-tool prose, one for the real answer. This used to be synthesized by the
  SSE route from suppressed tokens in staged mode; it is real progress and now
  belongs where the tokens themselves are produced.
- `comparing` / `checking` — emitted by the post-answer verification block,
  unchanged from before, and only when the turn has a basis to name (§11).

Status rows accumulate every detail line they reported (`StageLogEntry.details`) and keep them after the stage completes — nothing shown in the checklist is ever replaced or removed.

**Tense and per-paragraph disclosure (`StageList.tsx`, `ParagraphChecks.tsx`)**: a finished stage row reads in the simple past ("Looked for evidence") and only the currently-running row stays present continuous ("Looking for evidence") — a step that already happened shouldn't read as still happening. This is display-only: `stageLabel`/`stripTrailingEllipsis` pick the tense and drop a detail line's trailing "…"/"..." on a done row so it doesn't look like it's still going, but the logged `StageLogEntry.details` strings themselves are untouched, so the never-removed rule above still holds. The per-paragraph audit under the Synthesizing row follows the same "don't restate the default" instinct: `ParagraphChecks` renders one summary line (`N paragraphs checked`, plus `, no findings` / `, K flagged` / `, model check running` while any paragraph is still `pending`) and a row underneath only for a paragraph that has a deterministic finding or a model state worth naming on its own (`candidate`/`failed`) — a clean (`ok`) or still-pending paragraph gets no row, since the summary already accounts for it.

**`answer_final`** is a new `HarnessEvent`, `{ type: "answer_final", content
}`, yielded once — right after deterministic citation repair succeeds (after
the `round_checks` entry lands in `checksMeta`), before the verifier-model
branch runs. Past that point `done.content` will not change again: there is
no rewrite machinery (§6 is annotate-only), so the repaired content *is* the
final answer. The client reveals on `answer_final` and lets the verify badge
trail — the answer is never blocked on the audit, and the badge alone marks
it unverified until a verdict lands (no italic phase). `answer_final`
is **not** emitted on the early-exit path (`chatVerifyChecks` off, an aborted
turn, or empty content) — those still repair `done.content` for the wire, but
skip the `round_checks` block `answer_final` trails, so the client falls back
to revealing on `done` there, same as it always could.

The client tracks two separate strings per message: `draft` (live tokens,
shown inside the `synthesizing` stage row once that row is clicked open) and
`content` (set only by `answer_final` or, on the early-exit path, `done`) —
the rendered answer is always `content`, never `draft`. `token` and
`reasoning` still forward exactly as before; nothing the reader has seen is
deleted, except a repetition-loop draft: a `clear` moves the live buffer to
`superseded`, where it stays visible with an inline note saying why it
stopped being the answer (beta feedback: "text shown to user to never be
deleted just restyled … sometimes they actually want it"). Kept drafts are
markdown-rendered with live citations, not raw source — handing back
`[Title](/atlas/<uuid>)` for text the reader saw rendered is the same loss in
a different form.

**Superseded 2026-09-10** by this unified design: the pending
staged-vs-streaming A/B (`chat_delivery` PostHog property, the "staged"
`usePrefs` toggle, `useRevealOnDone`) is retired along with the two-mode
split it was measuring — see
[`docs/plans/archive/chat-staged-delivery.md`](./plans/archive/chat-staged-delivery.md)
for the design that preceded it.

## 9. LLM & embeddings layer

Provider is **OpenRouter** via the `openai` SDK (swapping model/provider is a
config change, not code). The chat model is set via `CHAT_MODEL` —
**`google/gemma-4-31b-it`** in the current deployment (the code fallback default
is `qwen/qwen3-32b`) — at `CHAT_TEMPERATURE` **0.3** (pinned; provider defaults
hover near 0.7, and a grounded citation machine wants low variance plus
comparable A/B runs — judges stay at 0 in `llm.ts`), with
`CHAT_MAX_OUTPUT_TOKENS` **16000** per completion. That ceiling caps a runaway
generation up front, not the answer length: 4096 turned out *not* generous
enough for exhaustive multi-doc governance answers, which could get cut off
mid-citation.

`makeOpenrouterStream` sets `stream_options.include_usage: true` (load-bearing —
otherwise streamed completions carry no usage for the rate limiter);
`makeOpenrouterJson` provides the non-streamed, temp-0 JSON call for the verifier
slices and small-talk judge with a true request-cancelling timeout.

`CHAT_CONTEXT_WINDOW_TOKENS` (default **200,000**) is what the UI context-size
indicator meters against — sized to the **smallest** model in the deployed
routing chains, not the primary's 256k, because an OpenRouter failover sends the
same full context and the honest ceiling is the chain minimum. Swap it alongside
`CHAT_MODEL` / `CHAT_MODEL_*` when the chains change.

Embeddings use `EMBED_MODEL` (default `qwen/qwen3-embedding-8b`, native 4096
dims) sliced + L2-renormalized client-side to `EMBED_DIM = 1024` — a constant
locked to the `vector(1024)` column and HNSW index. `sync-embeddings.ts` is a
separate best-effort lane, incremental by unit `content_hash`, that keeps
`atlas_doc_embeddings` current. Embeddings are a derived recall index, not atlas
truth: a stale vector only means that doc leans on lexical search for a while,
so the lane never blocks structural sync or the deploy/health gate.

Embed text is `title + content` with markdown links collapsed to their anchor
text (93% of atlas links target a bare doc UUID, which is pure token cost in a
vector) — stripping happens only in `retrieval/embed-text.ts`'s `buildEmbedText`,
never in the parser or the lexical index.

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
search then fuses ancestor/descendant lexical+semantic pairs onto the more
specific doc (`via` on the tool result).

## 10. Data model (Postgres)

`conversations`, `messages` (assistant content written post-stream, never
partial; `generation_id` drives async cost backfill), and `message_checks`
(migration `014_message_checks.sql` — one row per harness activity) hold chat
state; `users` backs OAuth + JWT sessions. `message_checks.kind` is now always
one of `round_checks | verify | smalltalk_judge` — `verify_recheck` and
`advisor_recovery` were the advisor/rewrite cycle's rows and nothing writes
them any more; the table's `action` column (`'annotate' | 'revised' | NULL`
per the migration comment) is likewise always inserted `NULL` now that
verdicts are annotate-only — kept rather than dropped since it costs nothing
idle and a migration to remove it isn't worth the churn. Retrieval tables are
`atlas_doc_meta`, `atlas_doc_embeddings` (`vector(1024)` + HNSW cosine index),
`atlas_addresses`, and `atlas_history`, with `sync_state`/`sync_log` as the
"what's loaded" pointer. Document content, full-text (MiniSearch), and the graph
live **in memory** (loaded once at boot, kept fresh by an in-process updater);
Postgres holds only what benefits from SQL.

## 11. API & SSE contract

All same-origin. Auth is a signed **HTTP-only cookie** — JS cannot read it, so
auth state always comes from the server (`/api/auth/me`), never from reading a
cookie.

| Endpoint | Contract |
|---|---|
| `GET /api/auth/me` | `200 → { id, name, avatarUrl, provider, email }` if signed in; `401` if not. Called on boot; drives all auth-gated UI. |
| `GET /api/auth/github` | Sign-in entry point; redirects to GitHub (sets a short-lived CSRF state cookie). |
| `POST /api/auth/signout` | Clears the session cookie. `200 → { ok: true }`. |
| `GET /api/usage` | `{ window: { tokens, limit, exceeded, resetsAt, windowMinutes, boosted }, global?: CommonsPool }`. Fetch on widget open and after each `done`. `global` is omitted when the commons feature is off or the credits API is unreachable. |
| `POST /api/chat` | SSE (below). |

**Request body:** `{ message, conversationId?, pageContext? }`, where
`pageContext` carries `{ path?, nodeId?, nodeTitle?, nodeDocNo?, actorSlug?, reportName? }`.

**Response:** `text/event-stream`, frames of `data: <json>\n\n`. The event union
(server `HarnessEvent` in `chat-orchestrator.ts`, mirrored client-side in `api.ts`):

```ts
{ type: "meta",        conversationId, tier? }
{ type: "token",       text }
{ type: "reasoning",   text }
{ type: "clear",       reason? }
{ type: "tool_call",   name, args }
{ type: "tool_result", name, ok, bytes, truncated?, originalBytes? }
{ type: "facts",       facts: { id, summary }[], bytes? }
{ type: "status",      stage, detail? }             // "recalling" | "querying" | "synthesizing" | "comparing" | "checking"
{ type: "answer_final", content }                   // the answer reveal point — see §8
{ type: "paragraph_check", index, text, findings }  // incremental deterministic checks, per paragraph — see §6
{ type: "paragraph_refute", index, parsed, candidates }  // per-paragraph MODEL audit (CHAT_REFUTE_MODE=paragraph, the default) — see §6.1
{ type: "export",      format, filename, mime, content, bytes }
{ type: "verify_result", overall, contradictions, notFound?, rulingIssued?,
                       invalidCitations, invalidDocNos, docNoMismatches,
                       ungroundedQuotes, ungroundedAddresses,
                       ungroundedCitationValues, paramMismatches,
                       lengthCapped }
{ type: "done",        content, usage: { input, output },
                       generationId, toolCalls, contextTokens? }
{ type: "error",       message }
```

`reasoning` is a model's "thinking" trace, accumulated client-side onto its
own field and never into `content` — it is scratch work, not answer prose, so
it is never markdown-rendered as the answer, citation-extracted, or verified.
It is emitted only when a provider actually sends one (`delta.reasoning`,
`delta.reasoning_content`, or a `reasoning_details` array — normalized by
`reasoningDelta` in `chat-loop.ts`). Forwarding is unconditional and there is
**no request-side knob** — we never send OpenRouter's `reasoning` param. We
don't need one: the strong tier's `openai/gpt-5.6-luna` already reasons
unprompted on 94 of 96 generations (30d production PostHog, 2026-08-24), so
traces render on strong-tier turns today. And asking for it lost its bakeoff
(`.cache/eval-bakeoff.2026-08-24-reasoning.json`): forcing reasoning on the
default tier (`gemma-4-31b-it`, which reasons on 8 of 257 generations
unprompted) bought +0.007 trimmed score for 2.3x latency, lower completeness,
and the run's first hard fabrications, while forcing `high` on the strong tier
scored *worse* (0.812) than its own adaptive default (0.908). Reasoning tokens
also come out of `max_tokens` — at a tight cap a model returns
`finish_reason:"length"` with an empty answer. A single global knob could only
be set to a value the measurement rejects for at least one tier, so a revisit
has to be per-tier. The client renders `reasoning` above the answer inside the
stage checklist's `synthesizing` row (§1, §8).

**A `clear` does not delete text the reader has seen — with one exception.** It
moves the live buffer into `ChatMsg.superseded` (a list of `{ text, reason }`,
arrival order) and the replacement renders BELOW it. `tool_round` fires *only
when content is non-empty*, so a naive clear would delete visible prose
mid-answer, which is exactly the jarring disappearance the beta feedback named.

| reason | producer | rendering |
|---|---|---|
| `tool_round` | a round produced text *and* tool calls — the model set the text aside and kept searching | leaked tool-call markup is folded into `reasoning` (thinking); remaining prose is kept, dimmed italic, **not** struck — unverified, not judged wrong. The caption that explains the draft sits in a bordered translucent box, not italic. |
| `degenerate` | the draft fell into a repetition loop | **deleted** — the one clear that still wipes |

`degenerate` is the deliberate exception: what the reader saw is machine noise
("the the the the…"), not a draft anyone could want back, so keeping it would
be the jarring thing. It wipes only the live buffer — drafts kept earlier in
the same turn survive it.

A whitespace-only buffer is also dropped — there is nothing to read. Absent
`reason` is treated as `tool_round` (preserve), so an older server can only
ever keep too much, never delete. `superseded` is live-session-only, like
`exports` — a reloaded conversation shows only the final answer.

**Slice JSON is repaired, and an unreadable finding is dropped rather than
counted.** `parseJsonish` tries the text as written, then with trailing commas
removed, then structurally closed (`closeTruncatedJson` shuts an unterminated
string and every open array/object, tracking escapes so a brace inside a quoted
span is not mistaken for structure) — output caps cut JSON mid-array routinely,
and the findings already emitted are real judgements worth keeping. A row that
still can't be repaired — malformed shape, a field that leaked into another
row's text (over-escaped quotes make one entry swallow the next one's fields,
seen in production) — is DROPPED, not defaulted into a contradiction.
Refutation-only means silence is always the safe failure mode: a parse defect
must never manufacture a contradiction the model never actually found, because
that finding is what drives the fail verdict shown on the badge. A whole-slice
parse failure already contributed nothing (`parsed: false`); this extends the
same fail-toward-silence rule to the individual row.

**Quoted spans that are not quotations.** `findUngroundedQuotes` is a hard
failure — an inline quotation the sources do not contain is misattribution. But
`extractQuotedSpans` reads *any* quoted span as a claimed verbatim atlas quote,
and two shapes are not: a quoted QUESTION (the assistant inviting the reader to
ask something) and a list item whose entire content is one quoted string (an
example or suggestion). Both are now excluded. This was a live hard failure: an
orientation answer closed with "You can ask things like:" and six example
questions, each was read as an ungrounded atlas quote, and the turn
hard-failed for no real reason. The exclusion costs no
detection — 0 of 11,340 served documents contain a quoted question of the
qualifying length — and a real quotation in prose, a quoted bullet carrying
attribution, and a `>` blockquote are all still captured.

**Prefetch facts as evidence.** The facts round (`facts/registry.ts`, tool name
`atlas_prefetch`) rides the transcript as an ordinary tool result, so the
verifier consumes it — but three things had to change before that worked in
practice, all of them observed wiping correct answers in production:

- It is **exempt from evidence eviction**. Budgeting is newest-first and the
  prefetch round is always the OLDEST tool entry, so on the tool-heavy turns
  where the budget binds it was dropped first — the verifier then judged an
  answer against evidence missing the material it was built from. Reserved
  before eviction; labels are renumbered so `[E1], [E2], …` stay contiguous.
  The budget itself is now 120,000 chars (`CHAT_VERIFIER_EVIDENCE_MAX_CHARS`).
- It carries its own `sourceClass: "reference"` and renders as `[REFERENCE]` in
  slice prompts. It is NOT retrieved atlas text — it is RedLens-injected context
  (product guide, glossary rows, entity rows, censuses). It stays grouped with
  atlas rather than external for quote-grounding, because glossary definitions
  genuinely are atlas text.
- The evidence-span match is **relaxed for `[REFERENCE]` entries, descriptive
  prose only**. Summarising injected documentation is its intended use, so an
  exact-substring bar would let a faithful restatement's evidence span fail
  code validation by construction, and DISCARD a real finding. Figures, dates,
  amounts, addresses, doc numbers, quoted atlas text and citations still
  require an exact span whatever the source — that relaxation never applies to
  a checkable value, only to descriptive prose, so it can't be used to smuggle
  a wrong number past validation.
- That relaxation is enforced **in code, not only the prompt**: measured against
  the real features guide, a faithful paraphrase of a `[REFERENCE]` entry scores
  **0.56** (bar 0.8) and a route span (`/radar`) is under the 8-char floor and
  scores 0 — a prompt-only rule would silently discard both. So a reference-class
  match uses `REFERENCE_SPAN_THRESHOLD` (0.5) and `REFERENCE_MIN_SPAN` (4), and
  only for descriptive prose — `hasCheckableToken` puts any finding carrying a
  figure, uuid or address back on the strict bar.

**Promised-tool guard (2026-09-01).** The loop's exit contract is "text + no
usable tool calls = the final answer", and it had one-shot guards for empty
content (`COMPOSE_STEER`) and repetition (`REPETITION_STEER`) but none for
content that *announced* a lookup it never made. Observed live 2026-08-20: a
round wrote "One moment while I search the atlas." with `finish_reason: stop`
and no tool_call deltas, and that shipped as the answer — badge-less, because a
turn with no citation, figure or quote gives the deterministic checks nothing to
fail and the verifier nothing to contradict, so `computeOverall` degrades to
`unverified`.
The reader waits the whole turn (the answer only reveals at
`answer_final`/`done`, §8) and is then shown a promise.
(Not the malformed-delta path the loop also documents: `chat_loop_malformed_tool_call`
has never fired.)

`chat-loop.ts` now buys ONE more round **with tools still available**, steered
by `PROMISED_TOOL_STEER`, when a round produced text, the turn has made zero
tool calls, a round remains, and `announcesUnmadeToolCall` (chat/announcement.ts)
fires. The announcement never lands on `msgs`, so the replay sees the
conversation as the failed round saw it; the client gets `clear(reason:
"tool_round")`, the same superseded-draft treatment as ordinary pre-tool prose.
One shot per turn — a second announcement ships as-is, and an empty retry falls
through to the compose guard, so the cascade is bounded at two extra
generations. The gate is regex + on-device similarity behind a deterministic
envelope, and the envelope is the part that protects legitimately tool-free
answers: `isUncheckableAnswer` means anything carrying a link, figure or doc
number is an answer and never reaches the embedding, which covers every
prefetch-built product answer (the features fact requires app areas to be
linked). Measured (`pnpm eval:announce`): regex 57% recall, hybrid 75%, both at
zero false fires over 109 answers — and on real traffic 17 of 18 tool-free
assistant answers never get past the envelope at all. See CLAUDE.md's "fourth consumer" note for
why this lane scores per sentence and does not use `isSmallTalk`.

`paramMismatches` is structured rather than a sentence
(`{ stated, actual, name, title, owner, uuid, doc_no }`) so the badge can link
the parameter's document and show the reader-facing `title` instead of `name`,
which is the terse extracted kv key (`maxamount`).
`ungroundedCitationValues` entries are already complete sentences server-side
("0.2% cited to A.1.1 (Title) but absent from it") — render them as-is rather
than prefixing a label.

**Stage vocabulary:** `recalling` (facts injected pre-model) · `querying` ·
`synthesizing` (once per generation burst) · `comparing` · `checking` (§8).

`paragraph_check.index` counts from 0 within the current generation burst and
resets to 0 on `tool_call` or `clear` — the buffered draft is being set aside.
One is emitted right after the token that closes each paragraph, plus once
more for the trailing paragraph at generation end, before `answer_final`.
`paragraph_refute` shares the same `index`/burst-reset rule but lands on its
own schedule — mid-stream when its model call lands in time, or in one flush
right before `verify_result` for whatever paragraph of the FINAL burst is
still outstanding; `parsed:false` means the call failed or timed out for that
paragraph, not that it found nothing.

**Ordering guarantees.** `meta` is always first and `done` always terminal.
`answer_final` lands after the last `token` and before `verify_result`;
`verify_result` lands between `answer_final` and `done`. A promised-tool retry
emits `clear(reason: "tool_round")` before its replacement round, which is
indistinguishable on the wire from any other pre-tool clear. Verification
stages (`comparing`, `checking`) are emitted **only when the turn has a basis
to name** — retrievals this turn, or earlier turns of the conversation — so no
detail ever reads "against 0 sources"; zero cited claims degrades the subject
to "the answer". Unknown event types are ignored by the client, so the
protocol extends backward-compatibly. Full shape, in order:

```
meta → [facts, status:recalling] → (tool_call, status:querying, tool_result)*
  → status:synthesizing → token* (paragraph_check paragraph_refute?)* → [status:comparing] → answer_final
  → [status:checking] → paragraph_refute* → verify_result → done
```

**`done.content` is always the authoritative answer** — streamed tokens may be
cleared before it arrives.

**Aborts.** Always attach an `AbortController` and pass its signal to `fetch`;
abort on widget close, new message, or unmount. It propagates to `req.signal`,
canceling in-flight LLM rounds so orphaned tool rounds don't burn tokens.

**Non-200 responses are plain JSON, not SSE:**

| Status | Body |
|---|---|
| `400` | `{ error: "empty_message" \| "invalid_json" }`, or `{ error: "message_too_large", limitBytes }` |
| `401` | `{ error: "unauthenticated" }` → trigger sign-in |
| `404` | `{ error: "conversation_not_found" }` |
| `429` | `{ error: "rate_limited", message, tokensUsed, limit, resetsAt, window }` + `Retry-After` (seconds) |
| `429` | `{ error: "commons_exhausted", message, global }` — shared pool dry; chat paused for everyone |

## 12. Evals & instruments

All are `bun scripts/eval/*.ts`, run manually (none gate CI yet) and most need
`OPENROUTER_API_KEY` plus built `docs.json` / `graph.json`.

| Script | What it measures |
|---|---|
| `pnpm eval:golden` | End-to-end golden questions through the real loop, real tool registry, real OpenRouter. Rubric grader (`eval-golden-grade.ts`) is pure and unit-tested; outcomes are `answered` / `partial` / `honest_decline` / `hallucinated` / `truncated` / `tool_failure`. Fixtures in `eval-golden-questions.ts` derive from the readiness plan's own Readiness targets, because that plan's source assessment was never committed. |
| `pnpm eval:verifier` | Gates the refutation-only verifier over tampered runs (swapped UUIDs, mutated numbers, appended rulings): contradiction catch-rate ≥0.8, ruling catch-rate ≥0.9, false-contradiction rate ≤0.05 on clean baselines. Fabrication/enumeration mutations are scored informationally, not gated — refutation-only has no claim table left to catch them against. `--mode paragraph\|answer` (default: `config.chatRefuteMode`) grades either refute mode over the same corpus — paragraph mode segments the (mutated) answer with the same `verify/paragraphs.ts` segmenter production uses and runs it through the real `createParagraphRefuter`, so this is literally the production merge path, not a parallel implementation. |
| `pnpm eval:slices` | Per-slice bakeoff across models for `refute` / `overreach` / `confirm` — the instrument behind "gemma-4 wins every slice," now re-targeted at the three-auditor shape. |
| `pnpm eval:retrieval` | Retrieval quality by slice (exact / disambiguation / prose control) — the instrument behind the kv-record grouping decision in §9. |
| `pnpm eval:facts` | Facts-lane recall; source of the `-0.05` similarity margin knee. |
| `pnpm eval:census` | Concept-census routing accuracy. |
| `pnpm eval:complexity` | Tier-router similarity lane: recall vs false fires over 180 labeled questions. |
| `pnpm eval:bakeoff`, `eval:wiki-ab` | Model bakeoffs and the constraints-wiki A/B. |

Open instrument work: wiring `eval:golden` into CI/release gating still needs a
decision on where and how often the LLM spend is worth it.
