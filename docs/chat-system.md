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
reducer mutates the last assistant message per event: `token` appends text,
`clear` wipes leaked pre-tool tokens, `tool_call`/`tool_result` build a trace,
`facts` records injected knowledge, `status` drives a ticker or stage
checklist, `verify_result` drives a pass/warn/fail badge, `export` auto-downloads
a generated file, and `done` sets the authoritative final answer.

The client `ChatEvent` union in `api.ts` mirrors the server's `HarnessEvent` in
`chat-orchestrator.ts` — **they must stay in sync**. The rule that keeps them
honest: *every input to `CheckReport.failed` must reach the client* — arrays and
booleans alike. Each one can be a turn's only finding, and a hard failure the
badge can't name renders a red chip that says the answer failed and then can't
say why. Three (`paramMismatches`, `ungroundedCitationValues`, `lengthCapped`)
were missing until 2026-08-21; when adding a fourth, wire it through to
`VerifyBadge`'s `issues` count in the same change. Supporting surfaces:
`VerifyBadge` (harness verdict), `StageList` (staged delivery), `ToolTrace`,
`Sources`, `LimitsMeter` + `ContextPie` (usage and context size),
`RateLimitNote`, `ProfileButton` / `SignInButtons` (auth), `usePrefs`
(delivery + placement preferences), `resume.ts` (conversation resume).

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
   (`RATE_LIMIT_TOKENS_PER_WINDOW`, default 500,000 tokens /
   `RATE_LIMIT_WINDOW_MINUTES`, default 120; 429 with `Retry-After` if
   exceeded) and the account-wide OpenRouter credit pool (`fetchCommons` in
   `credits.ts`). The commons gate **fails open**: `null` (key unset or credits
   API hiccup) never blocks chat; only a real `remaining <= 0` pauses chat for
   everyone (429 `commons_exhausted`).
5. **Resolve delivery mode** — `resolveDeliveryMode(body.delivery, config.chatDeliveryMode)`, resolved
   once up front so both the PostHog properties and the SSE loop use one value (§8).
6. **Resolve conversation** — verify ownership of an existing `conversationId`
   or `INSERT` a new `conversations` row; 404 `conversation_not_found` if the
   id isn't the caller's.
7. **Persist the user message** before streaming, then reload full history.
8. **Build the model input** — system prompt, windowed history, facts prefetch.
9. **Model tier routing** — `routeTier` + `resolveTierModels`.
10. **SSE stream** — emit `meta`, then run the harness, forwarding each event as
    `data: {json}\n\n`.
11. **Persist the assistant message** *after* the stream completes — never
    partial; skipped on abort. Harness rows go to `message_checks`.
12. **Post-response work** — conversation titling (`title.ts`) fires
    fire-and-forget after the SSE response closes, so its budget
    (`CHAT_TITLE_TIMEOUT_MS`, default 20s) costs the user no latency. It
    re-fires at turns 4 and 10; a conversation ending at turns 1–3 keeps its
    truncated `slice(0, 60)` seed title.
13. **Observability** — a per-turn PostHog trace keyed by conversation id
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

**Facts prefetch (`src/server/facts/`).** A deterministic pre-lookup runs before
the model's first request and injects whatever fires as **one synthetic tool
round** named `atlas_prefetch` (`registry.ts`'s `factRound`). Riding a real tool
round is load-bearing: the verifier, quote-grounding, and citation checks consume
injected knowledge as ordinary turn evidence with zero special-casing, because
`evidenceFromTranscript` walks tool messages generically. Facts that can fire:

- **Glossary + entity rows** (`prefetch.ts`) — definitional questions answer in
  one pass instead of burning a tool round.
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
model, so it costs tokens, never correctness. The STRONG chain has a second job: it is also what the
advisor's one recovery cycle replays on (§6.5), so a turn can reach the strong
model by failing an audit as well as by matching a signal.

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
| Curated reports | `atlas_report_multisigs`, `atlas_report_primitive_matrix`, `atlas_report_rewards`, `atlas_report_active_data`, `atlas_report_facilitator_responsibilities`, `atlas_report_govops_responsibilities` |
| Output | `export_findings` (chat-only; emits the `export` SSE event) |
| External (not Atlas) | `external_msc` (MCP) and `ask_external_msc` (chat-only sub-agent). Curated Monthly Settlement Cycle views from Soter Labs workbooks + Sky Forum permalinks. Tool results carry `source_class: "external"`; the verifier ignores them for Atlas quote-grounding and requires the non-Atlas disclaimer. |

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
2. **Deterministic checks** — `expandReferenceLinks` normalizes reference-style
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
3. **Sliced model verifier** (if `CHAT_VERIFIER_MODEL` set) — see below.
4. **Advisor escalation** (if `CHAT_ADVISOR_MODEL` set) — see below.

All harness activity is recorded to `message_checks`, one row per activity
(`round_checks`, `verify`, `verify_recheck`, `advisor_recovery`, `smalltalk_judge`),
each with its own `generation_id` feeding the async cost backfill. Harness tokens
count against the same per-user rate-limit window, so the harness can't spend
invisibly.

### 6.1 The sliced verifier (`verify/sliced-verifier.ts`, `verify/verifier-slices.ts`)

Since **2026-08-06 this is the only chat audit path.** `verify/verifier.ts`'s
single-prompt `runVerifier` is retained solely so `pnpm eval:verifier` can still
grade it — it is *not* a runtime fallback.

Four narrow auditors — **`claims`, `figures`, `sets`, `overreach`** — run
concurrently, each a JSON-mode, temp-0 call. The split was driven by measurement,
not taste: the single verifier already maxed fabrication (1.00) and ruling (1.00)
detection but was broken on wrong-doc (0.26–0.39) and numbers (0.44–0.63), and
missed structural misreads entirely. The slices sit on those fault lines.

**The load-bearing idea is not the slicing — it is "show your work."** The single
verifier once passed a real defect by asserting `"Spark is a Pioneer" [supported]`
off adjacent scaffold boilerplate. So every `supported` verdict must now carry a
**verbatim span**, and `validateSpans` re-checks that span against the evidence in
code: a span that isn't really there downgrades the claim to unsupported. The
model cannot assert support into existence.

Results merge into the single-verifier `Verdict` shape so `computeOverall`, the
advisor, the badge, and persistence consume it unchanged. The merge rule mirrors
`computeOverall`'s philosophy — **severity can be added, never removed**: a parsed
slice's contradiction or ruling always survives, but a clean-looking merge with
the `claims` backbone missing degrades to `unverified` rather than blessing an
answer the main audit never checked.

`overall` is computed **in code**, so the model can never upgrade a deterministic
failure. `invented_facts` is a severity *upgrade* only (warn → fail): it cannot
fail an otherwise-clean claim table, because a real fabrication always also
surfaces as an unsupported/contradicted claim, while a lone entry there is
usually a wording critique. Per-slice model overrides go through
`CHAT_VERIFIER_SLICE_MODELS="claims=m1,figures=m2,…"`; unnamed slices fall back
to `CHAT_VERIFIER_MODEL`.

### 6.2 The absence contract (`verify/absence.ts`)

An absence claim ("the atlas does not specify which chains") is supported by
evidence *not* containing something — there is no span to quote, by construction,
so `validateSpans` exempts it. That exemption alone produced a measured "false
absence" epidemic: the model claiming the atlas is silent about X when X has a
configured value, passing uncontested.

So any claim marked `absence: true` **and** `supported` now gets a three-outcome
audit, precedence `refuted > grounded > unverified`:

- **REFUTED** — the parameter table proves a real value exists (forces `contradicted`).
- **GROUNDED** — the evidence shows a genuine gap: a scaffold/placeholder doc, or
  a search that empirically found nothing.
- **UNVERIFIED** — neither; unproven either way.

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
  or an `atlas_filter` listing with `has_more` and `truncated` both false.
- **REFUTED** — that listing/extremum disagrees with a claimed count or winner.
- **UNVERIFIED** — otherwise, including ids-mode `atlas_first_seen` on a search
  batch. Hard-fails the turn (unlike absence’s unverified warn) and
  `describeCheckFailures` steers the advisor to **requery** the class, not
  rewrite from the page already gathered.

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

### 6.5 Advisor escalation (`verify/advisor.ts`)

Runs on fail, on warn once `CHAT_ADVISOR_TRIGGER_UNSUPPORTED_CLAIMS` (default 3)
unsupported claims accumulate, or on non-pass with retrieval trouble
(`CHAT_ADVISOR_TRIGGER_EMPTY_RESULTS`, default 2 — empty + error results
combined, or ≥2 repeated queries) / an exhausted loop. Triggers are computed
from free signals the harness already
produces (verdict, loop telemetry via `verify/round-checks.ts`, retrieval
quality) — never a model call to decide whether to make a model call.

`adviseRecovery` returns **requery | rewrite | decline**, triggering exactly one
revision + re-verify cycle — no retry loops; the second verdict is final even if
amber. The revision replays the whole transcript, which is why a single
unsupported claim no longer triggers it. On failure or abort, the original answer
stands.

The revision replays on the **strong tier**, not the chain that just failed the
audit (`recoveryStream` on `runVerifiedChat`, built in `chat.ts` because the
orchestrator is deliberately tier-blind; unset = replay on the turn's own chain).
The advisor decides *what* to do; the tier decides *who* does it. Measured
2026-08-21 over the 14 hard bakeoff queries under one judge — `gpt-5.6-luna` vs
`gemma-4-31b-it`: **6 wins / 0 losses / 6 ties**, mean 0.942 vs 0.781, and 1.6x
faster (26.6s vs 43.4s). Every win is a corpus-wide enumeration or generation
question, and the mechanism is completeness (0.95 vs 0.70) rather than
fabrication — the default model under-answers rather than inventing.

That bakeoff measured **first-pass** open-ended generation, not recovery. It is
only a partial justification for escalating recovery specifically: `troubled`
(above) also fires on fabrication-class failures — ungrounded citations, param
mismatches, contradicted claims — that the bakeoff never scored, and on that
same run luna's hard-fabrication rate was *higher* than gemma's (0.07 vs 0).
The mitigating difference is that revision is a narrower task than first-pass
generation — the advisor's steer pins the model to evidence already gathered
and names exactly which claims to fix — but that is a judgment call, not a
measured one. Escalation is upward-only and fires only on demonstrated
failure, so a miss costs nothing and a fire costs tokens; the re-verify pass
after revision (below) still catches a bad recovery before it ships. Note the
replayed transcript still carries the original citation-format instruction
(§3) — every format is accepted downstream, so this is deliberate.

## 7. Guard rails (pure code, no model in the loop)

Deterministic passes that fix or stop specific failure modes before they reach
the user. All are unit-tested and cost nothing.

| Module | What it prevents |
|---|---|
| `verify/citation-repair.ts` | Models can't reliably transcribe 36-char UUIDs out of long tool results, so link targets are never trusted: every `/atlas/` link is validated in code, invalid targets are re-resolved from what was actually retrieved this turn (near-miss uuid, doc_no href, truncated uuid, title match), and anything unrepairable is de-linkified so a dead link can never ship. |
| `verify/stream-link-gate.ts` | The post-answer pass is the authority, but on its own a fabricated link is *visible* until `done.content` replaces it. This gate holds token text from `[` until the link closes (links are short — imperceptible), applies the **same** `LinkJudge`, and emits the repaired form, so the stream and `done.content` agree and nothing flashes wrong. Non-links flush raw past a 400-char cap. |
| `verify/definition-block-gate.ts` | Reference-style answers open with a `[label]: /atlas/<uuid>` definition block — exactly the UUIDs a small model garbles. Buffers that block, repairs the whole citation table once, releases it, then streams prose through the ordinary inline gate. Anything that isn't a top definition block degrades to the plain inline gate. |
| `verify/citation-normalize.ts` | The entire checking layer keys on the inline `[text](/atlas/<uuid>)` shape. One pure, idempotent pass expands reference-style links into it (and repairs two malformed shapes measured in the model bakeoff). Inline-only answers come back byte-identical. |
| `verify/identifier-leak.ts` | Models paste internal handles into prose as pseudo-citations (`(Slug: grove-freezer-multisig)`) — it reads like a link and resolves to nothing. A leaked handle resolving to a doc **retrieved this turn** becomes a real citation; anything else is deleted with its separator. The evidence gate is deliberate: linking a doc the model never retrieved would assert grounding it never established. |
| `repetition-guard.ts` | Answer streams that collapse into repetition (`"aaaa…"`, `"the same as the same as…"`). Pure character- and phrase-level check, tuned against observed 2026-08-06 degenerations; thresholds stay high enough that normal prose and short lists don't trip it. |
| `output-budget.ts` | A single 300–600KB tool response overflowing the assistant that called it (observed on `atlas_entity` / `atlas_entity_params` for Prime Agents). See §5. |

## 8. Delivery modes

Two ways a turn reaches the user, selected by request body `delivery` ??
`CHAT_DELIVERY_MODE`. An unrecognized value normalizes to `streaming` rather
than throwing, since it doubles as the fallback for an invalid per-request
override.

**`streaming` (default)** — answer tokens forward live; the verify badge
resolves a few seconds after the last token. A revision visibly replaces the
flagged answer via `clear`.

**`staged`** — the SSE route suppresses `token`/`clear` entirely and renders an
honest stage progression instead, revealing the verified (possibly revised)
answer once, in the terminal `done`. The draft answer, the after-the-fact badge
downgrade, and the jarring mid-stream revision swap all disappear. Shape:

- `meta` carries `delivery`. The route synthesizes `synthesizing` (once per
  generation burst) and `finalizing` (before `done`); the orchestrator emits
  `comparing` before the deterministic checks in **both** modes — it stays
  mode-unaware.
- Client: `StageList.tsx` renders a stage checklist while a turn is in flight
  with empty content, gated `delivery !== "streaming"` so the default mode's
  pre-token window is visually unchanged. The verify badge structurally appears
  only with the revealed answer (no mid-flight fail→revised flicker).
  `useRevealOnDone` display-streams the final text over ≤ ~1.8s (instant under
  reduced motion) — display streaming, not generation streaming. Aborted staged
  turns show "Stopped before an answer was ready."
- Opt-in via the "staged" toggle (`usePrefs` `delivery`; null = follow server default).
- Known cosmetic artifact: a model that leaks pre-tool text produces a
  `synthesizing` stage before the first `querying` (the discarded burst) —
  harmless, an honest record of what happened.

**The default stays `streaming`** until the staged-vs-streaming A/B measures
perceived latency. `chat_delivery` rides the PostHog trace properties for
exactly that. Don't flip the default without the measurement — the whole trade
is perceived latency: answer + verify (+ revision) before anything readable.

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
slices, advisor, and small-talk judge with a true request-cancelling timeout.

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
state; `users` backs OAuth + JWT sessions. Retrieval tables are
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
| `GET /api/usage` | `{ window: { tokens, limit, exceeded, resetsAt, windowMinutes }, global?: CommonsPool }`. Fetch on widget open and after each `done`. `global` is omitted when the commons feature is off or the credits API is unreachable. |
| `POST /api/chat` | SSE (below). |

**Request body:** `{ message, conversationId?, delivery?, pageContext? }`, where
`pageContext` carries `{ path?, nodeId?, nodeTitle?, nodeDocNo?, actorSlug?, reportName? }`.

**Response:** `text/event-stream`, frames of `data: <json>\n\n`. The event union
(server `HarnessEvent` in `chat-orchestrator.ts`, mirrored client-side in `api.ts`):

```ts
{ type: "meta",        conversationId, delivery? }
{ type: "token",       text }                       // suppressed in staged mode
{ type: "clear" }                                   // suppressed in staged mode
{ type: "tool_call",   name, args }
{ type: "tool_result", name, ok, bytes, truncated?, originalBytes? }
{ type: "facts",       facts: { id, summary }[], bytes? }
{ type: "status",      stage, detail? }
{ type: "export",      format, filename, mime, content, bytes }
{ type: "verify_result", overall, confidence, action, claims,
                       invalidCitations, invalidDocNos, docNoMismatches,
                       ungroundedQuotes, ungroundedAddresses,
                       ungroundedCitationValues, paramMismatches,
                       lengthCapped }
{ type: "done",        content, usage: { input, output },
                       generationId, toolCalls, contextTokens? }
{ type: "error",       message }
```

`paramMismatches` is structured rather than a sentence
(`{ stated, actual, name, title, owner, uuid, doc_no }`) so the badge can link
the parameter's document and show the reader-facing `title` instead of `name`,
which is the terse extracted kv key (`maxamount`). The advisor steer still
consumes a sentence, built by `formatParamMismatch`.
`ungroundedCitationValues` entries are already complete sentences server-side
("0.2% cited to A.1.1 (Title) but absent from it") — render them as-is rather
than prefixing a label.

**Stage vocabulary:** `recalling` (facts injected pre-model) · `querying` ·
`reading` · `comparing` · `checking` · `advising` · `revising` · plus the
staged-only `synthesizing` and `finalizing`.

**Ordering guarantees.** `meta` is always first and `done` always terminal.
`verify_result` lands between the last `token` and `done`. A revision emits
`verify_result(fail)` → `status:advising` → `status:revising` → `clear` →
tokens → a second `verify_result` → `done`. Verification stages (`comparing`,
`checking`) are emitted **only when the turn has a basis to name** — retrievals
this turn, or earlier turns of the conversation — so no detail ever reads
"against 0 sources"; zero cited claims degrades the subject to "the answer".
Unknown event types are ignored by the client, so the protocol extends
backward-compatibly.

**`done.content` is always the authoritative answer** — streamed tokens may be
cleared or revised before it arrives.

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
| `pnpm eval:verifier` | Verifier catch-rate and false-positive rate over tampered runs (swapped UUIDs, mutated numbers, appended fabrications/rulings). The only remaining consumer of the legacy single-prompt `runVerifier`. |
| `pnpm eval:slices` | Per-slice bakeoff across models — the instrument behind "gemma-4 wins every slice." |
| `pnpm eval:advisor` | Advisor recovery-action quality. |
| `pnpm eval:harness` | Full `runVerifiedChat`; harness-on vs harness-off is the A/B instrument. |
| `pnpm eval:retrieval` | Retrieval quality by slice (exact / disambiguation / prose control) — the instrument behind the kv-record grouping decision in §9. |
| `pnpm eval:facts` | Facts-lane recall; source of the `-0.05` similarity margin knee. |
| `pnpm eval:census` | Concept-census routing accuracy. |
| `pnpm eval:complexity` | Tier-router similarity lane: recall vs false fires over 180 labeled questions. |
| `pnpm eval:bakeoff`, `eval:wiki-ab` | Model bakeoffs and the constraints-wiki A/B. |

Open instrument work: wiring `eval:golden` into CI/release gating still needs a
decision on where and how often the LLM spend is worth it.
