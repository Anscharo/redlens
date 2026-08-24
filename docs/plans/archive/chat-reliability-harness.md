# Chat Reliability Harness — Multi-Model Architecture Plan

## Overview

Make chat answers to complex governance queries trustworthy by adding two model roles around the existing conversational loop, without making the common case any slower:

- **Conversationalist** — the existing chat model (`CHAT_MODEL`). Owns the user-facing conversation: query formulation, tool calling, synthesis, streaming. Unchanged.
- **Verifier** — a *stronger* model (`CHAT_VERIFIER_MODEL`). Two-phase: free deterministic checks pipelined against every tool round, plus one final claim-level audit of the synthesis against the evidence actually retrieved that turn.
- **Advisor** — a chat-tier model (`CHAT_ADVISOR_MODEL`). **Escalation-only.** Never runs on a clean turn. When trouble signals fire, it reviews question + transcript + verdict and picks a recovery action, capped at exactly one recovery cycle.

Both new slots are env-driven OpenRouter models (same `llm.ts` abstraction; a model swap stays a config change). Unset slot = feature off = today's behavior. All harness activity streams live status to the UI ("querying… checking… conferring with advisor…"), so the system feels *more* alive, not slower.

Design decisions locked in:

- **Stream + badge**, never gate: the answer streams at full speed; the verification badge resolves a few seconds after the last token. On escalation, the revision **visibly replaces** the flagged answer with a "revised after verification" notice.
- **Verification is pipelined**: per-round evidence checks run concurrently with the next tool round (zero added latency); the final claim audit is the only post-answer model call.
- **Advisor need is assessed from free signals** the harness already produces (verdict, loop telemetry, retrieval quality) — never a model call to decide whether to make a model call.
- **One recovery cycle, hard cap**: advisor → one corrective action → re-verify → final badge, whatever it says. No retry loops.

---

## Why this shape

Mid-loop and end-of-turn verification are different jobs:

- **Mid-loop there are no claims yet** — only queries and evidence. What's checkable per round is *retrieval quality*: empty/error results, irrelevant hits, the model re-issuing near-identical queries (spinning). These checks are deterministic and free, and they run in parallel so they never block the stream.
- **At the end, claims exist.** "Every claim grounded in retrieved evidence, every citation valid, no invented facts, no ruling issued" is only checkable against the final synthesis. That's the one place a strong model earns its cost — and it runs *after* the user already has the answer.

The advisor is strategic, not mechanical: when the audit fails or the loop never converged, someone has to decide *what to do about it* — re-query with a better plan, rewrite from evidence already gathered, or honestly decline. That judgment call is the advisor's whole job, which is why it's a separate role rather than looping verifier feedback back in blindly.

The earlier pre-flight-planner idea is deliberately dropped from the default path: it taxed every query 1.5–4s before first token, including trivial ones. Accepted trade: a genuinely hard query may fail once and get rescued (slower for exactly the hard cases). If that stings later, a cheap heuristic gate (pre-flight only for detectably multi-part questions) can be added — not in v1.

---

## Data flow

```
POST /api/chat (chat.ts — auth, rate limit, persistence: unchanged)
    │
    ▼
runVerifiedChat (NEW src/server/chat-orchestrator.ts)
    │
    ├─ runChat (chat-loop.ts — control flow unchanged)
    │    round 1 queries ──► results ──► round 2 queries ──► results ──► synthesis streams
    │      │ SSE status:querying │                            │
    │      │ (tool calls within  └─► round-check E1            └─► round-check E2
    │      │  a round run in         (deterministic, parallel,     (parallel)
    │      │  parallel now)           never blocks the loop)
    │      └ SSE: tool_call / tool_result / token   (pass-through, as today)
    │
    ├─ synthesis done ──► SSE status:checking
    │    verify-checks.ts (pure code, free):
    │      citation regex · UUID ∈ docs index · quote-substring vs evidence
    │    verifier.ts (one non-streamed strong-model call):
    │      per-claim verdict vs evidence + round-check summaries
    │    overall = code checks ∧ model verdict
    │      (the model can never upgrade a deterministic citation failure)
    │    SSE: verify_result {overall, claims, invalidCitations, action}
    │
    ├─ escalation gate — advisor runs ONLY if a trigger fired (see below)
    │    SSE status:advising → advisor.ts picks: requery | rewrite | decline
    │    SSE status:revising → clear → corrective round (maxIterations:1 unless
    │      requery grants one tool round) → re-verify once → second verify_result
    │      UI shows "revised after a verification check"
    │
    └─ SSE: done (terminal; internal fields stripped)
```

### Advisor triggers (all free, computed in the orchestrator)

1. **Verifier verdict warn/fail** — contradicted/unsupported claims, invented facts, ruling issued, invalid citation UUIDs.
2. **Loop exhausted** — the answer was forced out by the final `tool_choice:"none"` iteration instead of converging naturally.
3. **Retrieval trouble** — ≥2 empty result sets or tool errors in the turn, or near-duplicate repeated queries (spinning).
4. **Deterministic check failures** — claim paragraphs with zero citations, quotes not found in evidence.
5. (Later, if round digests ship) **coverage gaps** — a decomposed sub-question never resolved.

On a clean turn none fire; the turn costs today's price plus one verifier call, and the user experience is: status ticks during retrieval → answer streams at full speed → "checking…" chip resolves to a verified badge ~1–3s later.

### Advisor recovery actions

Given question + transcript digest (tool names/args + result previews) + verdict, the advisor returns strict JSON choosing one action with concrete guidance:

- `requery` — one corrective tool round with named calls/args, then rewrite.
- `rewrite` — the evidence gathered is sufficient; rewrite removing/fixing every flagged claim, no tools.
- `decline` — the atlas doesn't support an answer; produce an honest decline naming what was checked.

Exactly one cycle, then re-verify once and show the badge — even if still amber. An amber badge with visible flagged claims is more trustworthy than silent retry churn.

---

## SSE protocol additions

New event types (server union + mirrored in `src/components/chat/api.ts`; old clients ignore unknown types — the existing switch already degrades gracefully):

```ts
| { type: "status"; stage: "querying" | "reading" | "checking" | "advising" | "revising"; detail?: string }
| { type: "verify_result";
    overall: "pass" | "warn" | "fail" | "unverified";
    confidence: number | null;
    action: "annotate" | "revised" | null;
    claims: { claim: string; status: "supported" | "unsupported" | "contradicted" }[];
    invalidCitations: string[] }
```

Status details are derived from harness state at zero model cost, e.g. `querying`: "Searching the atlas for 'Stability Scope facilitators'…" (from tool args); `reading`: "Reading 6 documents…"; `checking`: "Cross-checking 7 cited claims against 4 sources…" (claim count from citation extraction); `advising`: "Answer didn't fully check out — conferring with advisor…"; `revising`: "Revising with corrections…".

The verification stages (`comparing`, `checking`) are **only emitted when the turn has a basis to name** — retrievals this turn, or earlier turns of the conversation. A turn with neither (a meta-question answered without tools) runs the same audit silently rather than announcing a comparison against nothing; counts are printed only when they are real, so no detail ever reads "against 0 sources". Zero cited claims degrades the subject to "the answer", not a zero count.

Ordering guarantees: `meta` first, `done` always terminal; `verify_result` lands between the last `token` and `done`; a revision emits `verify_result(fail)` → `status:advising` → `status:revising` → `clear` → tokens → second `verify_result` → `done`. The existing `clear` semantics already reset the client's answer buffer, so revision reuses it unchanged.

---

## Server changes by file

### `src/server/config.ts` — new keys in the chat block

| Key | Env | Default | Meaning |
|---|---|---|---|
| `chatVerifierModel` | `CHAT_VERIFIER_MODEL` | `""` | Final-audit model; empty = model verify off. Docs recommend a stronger, *different-family* model than `CHAT_MODEL` (cross-family independence, same rationale as `curationClusterModels`). |
| `chatAdvisorModel` | `CHAT_ADVISOR_MODEL` | `""` | Escalation model; empty = advisor off. Chat-model tier is fine — recovery planning is easier than verification. |
| `chatVerifyChecks` | `CHAT_VERIFY_CHECKS` | on | Deterministic checks (free) — independent of the model slots. |
| `chatVerifierEvidenceMaxChars` | `CHAT_VERIFIER_EVIDENCE_MAX_CHARS` | `60_000` | Evidence digest budget for the final audit, newest-round-first. |
| `chatAdvisorTriggerEmptyResults` | `CHAT_ADVISOR_TRIGGER_EMPTY_RESULTS` | `2` | Retrieval-trouble threshold. |

Advisor/verifier calls set `temperature: 0` explicitly (graders/planners). The conversationalist stream keeps today's no-temperature behavior.

### `src/server/llm.ts` (+~35 lines)

`openrouterJson: JsonCall` — non-streamed `chat.completions.create`, `temperature: 0`, `response_format: {type:"json_object"}`, returns `{text, usage, generationId}`. The advisor/verifier analog of `ChatStream`: the injection seam that keeps everything unit-testable with fakes.

### `src/server/chat-loop.ts` (small, additive)

1. `done` gains `transcript: Msg[]` (the final `msgs` array incl. tool results) — evidence source for the verifier, base for revision. **Internal only**; the orchestrator strips it before SSE. Existing consumers ignore the extra field.
2. Tool calls within a round execute with `Promise.all` instead of the current sequential `for` loop (pure latency win; results still pushed in call order for deterministic transcripts).
3. Optional `onRoundEnd?: (info: {iter, calls, results}) => void` — fire-and-forget notification the orchestrator uses to launch per-round checks in parallel. It cannot block or mutate the loop.

### NEW `src/server/round-checks.ts` (~80 lines, pure)

Deterministic per-round signals, accumulated across the turn: empty-result and error counts, near-duplicate query detection (normalized args similarity), per-result relevance floor (search score fields already present in tool output). Output feeds the escalation gate and the final verifier prompt ("retrieval telemetry" section). Model-based per-round digests are explicitly **not** in v1 — add later only if the final audit proves too slow over raw evidence.

### NEW `src/server/verify-checks.ts` (~120 lines, pure)

- `extractCitations(answer)` — shared citation regex with `eval-golden-grade.ts` (export one constant so grader and runtime can't drift).
- `checkCitationUuids` (UUID exists in the docs index — invalid UUID is a hard fail the model can't override), `checkCitationFormat` (bare `/atlas/` links, uncited claim paragraphs), `checkQuotes` (quoted spans must appear, whitespace/case-normalized, in the turn's evidence or the cited doc's content).
- `runDeterministicChecks(answer, evidence, ix): CheckReport`.

### NEW `src/server/verifier.ts` (~140 lines)

- Zod `Verdict` schema + tolerant `parseVerdict` (fence-strip, first-`{`-to-last-`}` salvage).
- `buildVerifierPrompt(question, answer, evidence, checks, telemetry)` — evidence entries labeled `[E1] atlas_query({...}) →`, newest-first, capped at the evidence budget.
- `runVerifier({call, model, ...})` — any transport/parse failure degrades to `{overall: "unverified"}`; verification flakiness must never break chat.
- Verdict JSON: `claims[{claim, status: supported|unsupported|contradicted, evidence: ["E2"], cited_uuid, note}]`, `invented_facts[]`, `ruling_issued`, `confidence`, `feedback` (≤80 words — becomes the advisor's input on escalation).
- `overall` computed **in code**: any contradicted claim / invented fact / ruling / invalid citation → `fail`; only unsupported claims → `warn`; else `pass`.

Draft system prompt core (tuned against the eval below): judge ONLY against the evidence — "your own knowledge of Sky, MakerDAO, or governance is irrelevant; if the evidence does not contain a fact, the fact is unsupported even if you believe it is true." Numbers, dates, rates, role assignments, document identities/statuses are claims. Hedged statements ("the atlas does not cover X") are supported when the evidence pattern matches the hedge. Don't judge style or citation formatting (code handles that). Strict JSON out.

### NEW `src/server/advisor.ts` (~110 lines)

`adviseRecovery({call, model, question, transcriptDigest, verdict, telemetry, signal})` → `{action: "requery"|"rewrite"|"decline", guidance, calls?}` or `null` on failure/timeout (5s hard cap; null = fall back to plain annotate — the badge stays amber, chat never blocks on the advisor).

Draft prompt core: "You are supervising a governance assistant whose answer failed a verification audit (verdict below) after the retrieval attempts shown. Decide the single best recovery: `requery` (name the exact tool calls that would fill the gap), `rewrite` (the evidence already gathered is sufficient — instruct which claims to remove or correct), or `decline` (the atlas does not support an answer — instruct an honest decline naming what was checked). One action, ≤80 words of guidance, strict JSON."

### NEW `src/server/chat-orchestrator.ts` (~150 lines)

`runVerifiedChat({ix, messages, stream, jsonCall, question, signal})` — implements the flow diagram: status emission, round-check accumulation via `onRoundEnd`, final verify, escalation gate, one recovery cycle (revision runs `runChat` with `maxIterations: 1`, or `2` for `requery`, reusing the existing forced `tool_choice:"none"` final-iteration mechanism), re-verify once, sanitized `done`. Advisor/verifier usage carried on internal `checksMeta` for persistence; stripped before SSE (test-guarded).

### `src/server/chat.ts`

Swap `runChat` → `runVerifiedChat` at the call site (~line 123) with `jsonCall: openrouterJson`; sanitize helper strips `transcript`/`checksMeta`; `persistAssistant` returns the message id and inserts `message_checks` rows; check tokens added to `conversations` totals.

### `src/server/rate-limit.ts`

Window SUM extended with `message_checks` tokens — advisor/verifier spend counts against the same per-user budget (the harness can't blow past the token window invisibly).

### Migration `src/server/migrations/<next>_message_checks.sql`

```sql
CREATE TABLE IF NOT EXISTS message_checks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind           TEXT NOT NULL,   -- 'verify' | 'verify_recheck' | 'advisor_recovery' | 'round_checks'
  model          TEXT,            -- NULL for deterministic rows
  action         TEXT,            -- 'annotate' | 'revised' | NULL
  verdict        JSONB,           -- Verdict / recovery decision / CheckReport (incl. original answer when revised)
  overall        TEXT,            -- 'pass'|'warn'|'fail'|'unverified' (extracted for cheap aggregation)
  input_tokens   INT, output_tokens INT,
  generation_id  TEXT, cost_usd DECIMAL(10,6), latency_ms INT
);
CREATE INDEX IF NOT EXISTS message_checks_message ON message_checks(message_id, created_at);
CREATE INDEX IF NOT EXISTS message_checks_window  ON message_checks(created_at);
CREATE INDEX IF NOT EXISTS message_checks_cost_pending ON message_checks(generation_id)
  WHERE generation_id IS NOT NULL AND cost_usd IS NULL;
```

One row per model call (multiple per message: verify + possible advisor + recheck) rather than columns on `messages`. `overall`+`action`+`model` make "verified vs unverified accuracy" and escalation-rate dashboards a single GROUP BY. Each row carries its own `generation_id`, feeding the existing async cost backfill (and improving on today's one-id-per-turn undercount).

---

## Frontend changes

- **`src/components/chat/api.ts`** — mirror the new event types.
- **`src/components/chat/useChatStream.ts`** — `ChatMsg` gains `verify?: {status: "checking"|"pass"|"warn"|"fail"|"unverified"|"revised", result?}` and a transient `statusLine?: string`; reducer handles `status`/`verify_result` (`clear` already covers revision).
- **NEW `src/components/chat/VerifyBadge.tsx`** (~60 lines) — chip near the Sources cluster: "verifying…" spinner → "verified" / "caution: N unsupported claims" / "failed verification", expandable claim list; revised answers show "This answer was revised after a verification check."
- **`Message.tsx`** — render the badge; the live status ticker renders above the streaming answer where the tool trace sits today.
- Repo convention: show stats before UI change lands; load the ui-look-and-feel skill for styling; `patch-notes.md` gets one user-facing bullet when the badge ships (e.g. "Chat answers are now fact-checked against the atlas, with a live verification badge").

---

## Cost & latency profile

- **Clean turn** (the common case): today's conversationalist cost + one verifier call ≈ 12–17k input / ~600 output tokens (evidence-dominated), run entirely after the answer streamed. Zero perceived answer latency; badge lands ~1–3s after the last token. Round checks and status events are free.
- **Escalated turn** (rare): + one small advisor call (~2k in / ~200 out) + one corrective round + one re-verify ≈ up to 2× turn cost — visible to the user as the system catching and fixing its own mistake, which is the strongest trust signal the UI produces.
- **Snappiness wins independent of models**: parallel tool execution within a round; pipelined round checks; status ticker making retrieval progress visible.
- All check tokens count in the per-user rate-limit window.

---

## Eval & tests

- **Verifier eval** (the key new instrument): `eval-golden.ts --save-evidence` stores turn transcripts; NEW `eval-verifier-mutations.ts` — pure tamper functions over saved passing runs (swap citation UUID to unknown / to real-but-wrong doc, mutate a number/date, append a plausible fabrication, append a ruling); NEW `eval-verifier.ts` grades unmutated runs (false-positive rate) and each mutation class (catch rate) through the real `openrouterJson`. `pnpm eval:verifier`, nonzero exit under thresholds (start: catch ≥ 0.9 on fabrication/ruling, FPR ≤ 0.1; deterministic classes must be 1.0 by construction).
- **Full-harness golden eval**: `eval-golden.ts --harness` runs `runVerifiedChat`; report the rubric-outcome × verifier-overall matrix (rubric `hallucinated` ∧ verifier `pass` = a verifier miss) and the escalation rate over the fixture set. Same fixtures harness-on vs harness-off = the A/B instrument.
- **Unit tests** (bun, fake-injection style of `chat-loop.test.ts`): `round-checks.test.ts` + `verify-checks.test.ts` (pure, exhaustive); `verifier.test.ts` (canned/garbage JsonCall, degradation to unverified, code-overrides-model); `advisor.test.ts` (action parsing, timeout → null → annotate fallback); `chat-orchestrator.test.ts` (event ordering incl. revision sequence, exactly-one recovery cycle, escalation gate logic per trigger, internal fields never forwarded); extend `chat-loop.test.ts` (transcript, parallel tool execution ordering, onRoundEnd) and `chat.test.ts` (sanitization, `message_checks` persistence).

---

## Rollout (each phase independently valuable; unset slots = today's behavior)

1. **Plumbing + deterministic verification (free).** Migration, config, `round-checks.ts`, `verify-checks.ts`, parallel tool execution, `done.transcript`, minimal orchestrator (checks only), `status` + `verify_result` SSE, `VerifyBadge`, rate-limit SQL, persistence. Live invalid-citation/ungrounded-quote detection on every answer from day one.
2. **Model verifier (annotate only).** `openrouterJson`, `verifier.ts`, prompt; tune against `pnpm eval:verifier` before setting `CHAT_VERIFIER_MODEL` in prod. Shadow mode possible: persist verdicts, hold the badge behind a frontend flag for a burn-in period.
3. **Advisor escalation.** `advisor.ts`, trigger gate, recovery cycle, revision UX. Enable only after Phase 2 shows acceptable FPR (a false-positive verifier verdict is what would trigger pointless revisions).
4. **Tuning.** Escalation-rate + verdict dashboards from `message_checks`; optional per-round model digests if final-verify latency warrants; optional heuristic pre-flight planning for detectably multi-part questions.

---

## Key risks / guards

- The verifier model can never upgrade a deterministic citation failure — `overall` is computed in code.
- Verifier or advisor flakiness never breaks chat: JSON-call failure → `unverified` badge / annotate fallback; the turn always completes.
- Exactly one recovery cycle — no retry loops; the second verdict is final even if amber.
- `transcript`/`checksMeta` never reach SSE or the `tool_calls` jsonb column (test-asserted).
- Old frontend clients ignore the new event types; the protocol change is backward-compatible.
