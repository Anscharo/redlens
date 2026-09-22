# Jev (TypeSafe) in SAbR — reference notes

**Status (2026-09-22):** **A0 — small-talk judge — is SHIPPED**: Jev replaced the gemma classifier in that seat and the judge now runs on every turn, not only the first. **A1 — citation support — is WIRED** as per-document marks on the answer's Sources chips (✓ backed / – doesn't cover a line / ! may say otherwise), with every Jev `contradicts` routed through the existing `confirm` gate first; see "Wired" at the end of §A1. **A2, A3 and B remain unbuilt research.**

## A0. Small-talk judge seat — MEASURED 2026-09-22

The seat is `judgeSmalltalk` (`verify/smalltalk.ts`, `config.chatSmalltalkJudgeModel` = `google/gemma-4-26b-a4b-it`) — **not** the `refute`/`overreach`/`confirm` verifier slices, which are a different gemma seat and untouched here. One binary call on the first user message; the final gate on skipping the audit for greetings; fail-closed (any failure ⇒ full audit).

**Built:** `src/server/jev.ts` (raw-fetch `/systemone` client, same `OPENROUTER_API_KEY`, `CHAT_JEV_MODEL` default `typesafe/jev-1.13`), `verify/smalltalk-jev.ts` (`judgeSmalltalkJev`, one Noul), both with colocated tests; the bakeoff at `scripts/aux/eval-smalltalk-judge.ts` now runs both arms over `eval-smalltalk-cases.ts`. **Nothing is wired** — no request path reads any of it.

**Why the old numbers couldn't decide it:** the 42-case set that chose the incumbent is saturated (gemma 100%, 0 dangerous). The case file adds a 42-case **hard** tier — single ambiguous words (`updates`, `status`, `rules`), greeting-shaped questions (`hi?`), non-English courtesies, compound courtesy-then-ask turns, and capability questions in conversational clothes. Labels follow the shipped prompt's own "when unsure: false", so ambiguity is labeled factual — the fail-closed direction.

**Results** (84 cases × 2 and × 3 passes; 420 calls per arm total; both runs agree):

| | gemma-4-26b-a4b-it | typesafe/jev-1.13 |
|---|---|---|
| accuracy, all cases | 95.0% / 97.4% | **100% / 100%** |
| accuracy, hard tier | 91.0% / 94.6% | **100% / 100%** |
| dangerous (factual ruled small talk) | 8 and 6 | **0 and 0** |
| missed small talk (harmless) | 0 | 0 |
| call failures **under 6-way concurrency** (5 s timeout ⇒ silent full audit) | 7/168 and 24/252 | **0/420** |
| latency p50 / p95 | 938–1174 / 3040–3612 ms | **342–355 / 455–489 ms** |
| cost per call | — | $0.0000194 |

The failure column is an eval artefact and must not be read as a production rate: the bakeoff fires 6 concurrent calls, production fires one per conversation. The production figure is **1 null of 46** `smalltalk_judge` rows (~2%), with p50 1337 ms / p95 3473 ms — slower live than in the eval, and still a real hole, since a failed judge silently costs the bypass.

Jev's two classes came back **fully separable on all three runs**, bounds within noise of each other: highest P(smalltalk) on a factual case **0.50–0.52**, lowest on a small-talk case **0.75–0.76**. `SMALLTALK_JEV_THRESHOLD = 0.65` sits mid-gap rather than at the sweep's own zero-dangerous edge (0.55), which is only ~0.03 above the worst factual case. The eval scores at that shipped constant, not at its own fitted point.

Repeatable gemma errors, all in the dangerous direction: `hey, can you help me with something?`, `is that everything?`, `quick sanity check — does that sound right?`, plus `bonjour, comment ça marche?`, `hey, is that actually true?`, `who are you?`.

**One caveat on the hard tier.** The 0.65 threshold is **in-sample**: picked from the same 84 cases it is scored on. Full separability makes that far less fragile than a fitted margin, but it is not a held-out number — real traffic is. (A second caveat, that the follow-up-shaped cases were out-of-population because the judge only ever saw first messages, was retired when that gate was removed; see "Multi-turn expansion" below. Those cases are now the most load-bearing in the file.)

**"Should be faster" is true but is not the win — measured, not argued.** The judge races the conversationalist and is awaited before `finish` (`chat-orchestrator.ts:649`), so it *could* gate the turn. Over 45 paired rows in `message_checks` it never did: judge slower than the answer it raced on **0 of 45**, including on the three turns the bypass actually fired (763 ms judge vs 2065 ms answer at 58 chars). Even a one-line greeting answer outlasts the judge. The real wins are **correctness on the hard tier**, **removing the call-failure hole** that today silently costs the bypass, and **one fewer model family plus no unparseable-JSON path** (a Noul cannot be malformed).

### Real-traffic check — RUN 2026-09-22, the gap survives

`scripts/aux/eval-smalltalk-real.ts` (authorized before running; it sends stored user messages to OpenRouter). Population reproduced with the production predicates, not approximated: first user message of each conversation, `isUncheckableAnswer` true. Dev DB — 106 conversations, **60 distinct eligible messages**.

- **Separation holds: 0 of 60 real messages fall inside the 0.52–0.75 gap.** The distribution is sharply bimodal — 54 below 0.1, 2 in 0.1–0.2, 4 above 0.9, and **nothing at all between 0.2 and 0.9**. The threshold is resting on empty space on real traffic, not just on hand-written cases. This is the check the census lane wishes it had run early, and it came back clean.
- **100% agreement** (59 comparable rows): 4 bypassed by both, 55 audited by both, **zero disagreements in either direction**. So the swap changes no ruling on this traffic — it changes the failure rate and the hard-case headroom.
- The 4 bypassed are `good morning`, `hello`, `ping`, `whats up` — all genuinely pure conversation. The sharpest evidence is a near-minimal pair: **`whats up` → 0.90 (bypass), `whats new` → 0.06 (audit)**. That is exactly the casual-factual trap the hard tier was built around, decided correctly with an 0.84 margin.
- gemma failed 1 of 60 (~1.7%), matching the ~2% production rate; Jev failed 0. Latency p50 374 ms vs 920 ms. Cost for the whole pass: $0.0012.

**Caveat that remains:** this is the dev DB, the same limitation the announce lane hit. 60 messages is enough to falsify the gap and it did not, but re-run against production before the swap ships.

**Verdict: Jev takes the seat on reliability and headroom, not on rulings.** On today's traffic the two arms are indistinguishable; Jev wins because it never fails a call, never emits unparseable JSON, holds 100% on the hard tier where gemma loses 6–8 in the dangerous direction, and gives us the threshold instead of a boolean.

### Multi-turn expansion — WIRED 2026-09-22

The judge previously ran on the **first user message only**, so a bare `thanks!` on turn 3 always paid a full audit. That gate is gone: every marker-free user message is now judged.

Held out before wiring, because no first-turn result can speak for later turns — the labeled set, the hard tier and the 60-message real check were all first messages. `JUDGE_POPULATION=later` over **81 distinct real later-turn messages**:

- **0 of 81 inside the 0.52–0.75 gap.** The distribution is even more extreme than on first turns: 72 below 0.1, and **nothing whatsoever between 0.42 and 0.91**. Exactly one message would bypass (`ping`, 0.91).
- Both disagreements with gemma are **gemma-only bypasses** (`werre what` p=0.32, `?` p=0.42) — i.e. Jev is the *more* conservative arm on precisely the ambiguous-alone messages this expansion newly exposes, and never bypasses where gemma audits.
- The follow-up shapes the expansion exposes score at most **0.45** (`is that everything?`), 0.20 below the threshold.

**The judgment stays message-only.** Feeding Jev the prior turn was considered and rejected: its accuracy degrades as irrelevant state grows, and judging the words alone already errs toward auditing, which is the fail-closed direction. A message that is pure conversation only *in context* gets audited — that costs a few seconds, never trust.

**Negative result worth keeping: hardening the criterion made it worse.** The obvious companion change to the expansion was a clause in the `false` criterion naming follow-up shapes explicitly ("a message referring back to something said earlier… is also false"). Written, measured, reverted the same day. Accuracy stayed 100% both ways — but the separation gap **narrowed from 0.50/0.76 to 0.58/0.69**, squeezing the threshold from both sides at once. The plain criterion already handles follow-ups without being told (`is that everything?` 0.45, `so, thoughts?` 0.25, `what else?` 0.16). The lesson generalizes to every Jev question here: at 100% accuracy the metric to tune on is the **margin**, not the score, and more criteria text is not automatically more precision. The reverted wording is pinned with a comment in `smalltalk-jev.ts` so it is not "fixed" again.

**Gemma is gone, not retired.** `judgeSmalltalk`, its prompt, its tests and the bakeoff's baseline arm were all deleted on 2026-09-22 (initially kept as an eval-only baseline on the `runVerifier` precedent, then removed by decision). `verify/smalltalk.ts` is now purely deterministic — `GROUNDABLE_RES` and `isUncheckableAnswer`, no model, no network. The numbers in this section are the only record of the comparison, which is why they are stated here in full rather than as "see the eval".

`eval-smalltalk-judge.ts` is still a bakeoff: `JUDGE_MODELS` takes any number of **Jev** models, which is how a new release gets compared against the pinned one before the pin moves.

**Deterministic checks should NOT move to Jev.** `GROUNDABLE_RES` (`smalltalk.ts:15`) detects digits, links, UUID fragments and addresses — regex does that exactly, in microseconds, and Jev is documented weak on literal/numeric detection. The place a cheap judgment would *add* rather than replace: the judge never fires after the first turn, so `"thanks!"` at turn 3 always pays a full audit. Separate follow-on.

## Context

Preliminary research into where Jev (TypeSafe's typed-judgment model: returns a choice / yes-probability / graded level, never text) earns a place in SAbR. Direction set 2026-09-21: highest value is **(A) chat** — specific verification checks ("is this claim backed by the doc it cites?", "does the response answer the question?"), possibly tool calling — and **(B) reports**. The stated worry was Jev's small context. The research says that worry applies to tool calling and to `refute`, and **does not apply to the two named checks**: the largest atlas document is 6,207 chars (median 125), and answers run median 1.7k / max 15k chars.

Jev is on OpenRouter, so there is no new vendor, key, or SDK.

## Jev, as it applies here (live docs + OpenRouter guide, read 2026-09-21)

- `POST {OPENROUTER_BASE_URL}/systemone` — i.e. `https://openrouter.ai/api/v1/systemone`, the base URL the repo already uses — with the existing `OPENROUTER_API_KEY`. **Not** chat/completions, so it bypasses the `openai` SDK client and the `@posthog/ai` wrapper: it is a raw `fetch`, exactly like `src/server/retrieval/embed.ts`.
- Body `{model, state, questions}`; model `typesafe/jev-1.13` (pin it; `~typesafe/jev-latest` floats). Response `{id: "gen-dec-…", answers, usage: {input_tokens, output_tokens, cost}}` — `id` starts with `gen-`, so the existing `message_checks.generation_id` convention holds, and cost arrives inline.
- Primitives: **Choice** (≤255 options, per-option probabilities + confidence), **Noul** (P(yes)), **Score** (2–10 described levels). Questions over one `state` run in parallel, blind to each other.
- **$0.042 / M input tokens, output free. 32k context.** The entire atlas (2.38M chars) is ~$0.03 per question-pass — whole-corpus semantic sweeps become affordable, which is what makes (B) interesting.
- Latency: marketing says ~100 ms; TypeSafe's own cookbooks measured 0.16–1.2 s. Measure from Railway.
- Documented weak spots (`docs.typesafe.ai/model-jaggedness/jev-1.13`): reads literally; can't count; weak on numeric/date comparison; degrades on multi-hop wording; **accuracy falls as irrelevant state grows** (→ one claim + one doc per request, not a batch); not hardened against adversarial state; cannot generate.

## A1 — MEASURED 2026-09-22. Big catch-rate win, one unresolved design flaw.

`pnpm eval:citation` (`scripts/eval/eval-citation.ts` + `-cases.ts`, judged by `verify/cite-support.ts`). **506 cases from 17 stored answers**: 97 real citations plus 409 built by repointing a real sentence at a different document, which keeps the prose real and makes the label certain. $0.02 for the whole run; reruns are free (`.cache/jev/citation`, keyed on model+state+questions).

**The Choice gate is closed:** OpenRouter's `/systemone` returns `probabilities` *and* `confidence` for a Choice intact. The three-Noul fallback this doc reserved is not needed.

Flag rate = the share where the check surfaces something (`contradicts` hard, `says_nothing` soft). For the real citations that is the **false**-flag rate.

| case class | n | lexical (ships, dark) | Jev | Jev + children |
|---|---|---|---|---|
| **real citations** | 97 | **6%** | 21% | 21% |
| random doc | 97 | 70% | 100% | 100% |
| parent doc | 91 | 58% | 95% | 49% |
| sibling doc | 88 | 51% | 97% | 95% |
| **same title** | 38 | 24% | **76%** | 76% |
| **cited elsewhere** | 95 | 46% | **94%** | 93% |

**The upside is real and large** on the two classes that motivated the check. `same_title` (the atlas has 142 identically-titled "Rate Limits" docs, one per agent) goes 24% → 76%. `cited_elsewhere` — the link now points at the wrong one of two documents the same answer already cites, so the right source is definitely inside the turn's pooled evidence — goes 46% → 94%. (That class does **not** assert the claim is true in the substituted doc; only that the attribution moved within the evidence the turn actually used.) It is the class the shipped `refute` auditor **cannot see at all**: repointing a link leaves the answer prose byte-identical, and refute has no way to resolve a UUID to a document, so it scores 0 there by construction rather than by weakness.

**On the corpus's independence:** 97 citations, but they come from 17 stored answers to roughly ten distinct questions, so these are not 97 independent samples — several sentences in one answer share a topic and a retrieval set.

**The headline against it — 21% vs 6% false flags — does not survive reading the cases, but it does not clear Jev either.** Of the 20 flagged real citations, 6 are markdown table rows and 14 prose. Adjudicating the 14 by hand:

- **~2 are not claims at all** — `* **Spark**:` and `* **Keel**:`, bullet labels left behind by the segmenter. Garbage in. The lexical check never saw these because `MIN_CLAIM_WORDS` (6) silently filtered them; `citationPairs` deliberately dropped that filter, and this is the cost.
- **~6 are a citation class the question does not model.** "Documents regarding `Instance Financial CRRs` (…) show high modification counts" cites the doc it is *about*. The doc cannot state its own revision history, so `says_nothing` is literally correct — but the citation is correct usage too. **This is a pointer, not a source**, and A1 as specified conflates the two. Any wiring must separate them or it will emit a soft note on legitimate citations every time an answer says "the document X".
- The remainder are genuinely borderline, and some are probably real defects — which is the methodological catch worth stating plainly: **"positive" here means "a model wrote it", and the entire premise of this check is that models mis-cite.** So 21% is an *upper bound* on the false-flag rate, not a measurement of one.

**Children in state: only matters for the parent class, and it reframes that class rather than settling it.** Adding children drops the parent flag rate 95% → 49% and changes nothing else (real citations 21% either way, same_title 76% either way). Whether that is a fix or a regression depends on an unanswered product question — *is citing a parent a misattribution?* The reader renders a doc together with its children, so a human following the link sees the text. The lexical check's own comment asserts parent-flagging is "intended, not noise". **This eval labels `parent` a negative, and that label is contestable** — it is the one number in the table that should not be read as settled.

### Second pass (same day): fix the inputs, keep the full judgment

The first pass above over-read its own noise. Retreating to `contradicts`-only (1.4% false contradictions on prose, 26% catch on same-title) was considered and **rejected**: it throws away the half of the check that attests a paraphrase is actually backed. Instead, the three causes of the false flags were fixed at their source, in `verify/cite-pairs.ts`:

1. **Tables** — rows are rewritten into labelled prose before segmentation (`Sender: Sky Core; Recipient: …; Amount(s): …`), with link-only cells folded on as the row's citation. The judge was previously handed `| Sky Core | 5M USDS | Planned |` with no header.
2. **Degenerate segments** — a pair needs three real words once links and markup are gone. All 16 pairs this removed were bare label bullets (`* **Aave**`, `* **Spark**:`). Those bullets do imply a claim from their heading ("Aave is an integration-boost vendor"); judging them would need the heading in state — future scope.
3. **Pointer citations** — a fourth Choice option, `about_document`: the claim is about the document itself (it exists, its title, how often it changed, "e.g." examples), so the link is a pointer, not a source. It is never a flag.

**Results** — 407 cases from 15 answers, 80 real citations (after the fixes), $0.02, cached reruns make zero calls:

| class | n | lexical | Jev 3-option | **Jev + `about_document`** |
|---|---|---|---|---|
| **real citations (false-flag, unadjudicated)** | 80 | 8% | 18% | **11%** |
| random | 80 | 85% | 100% | 100% |
| parent | 74 | 76% | 100% | 99% |
| sibling | 71 | 68% | 97% | 96% |
| **same title** | 24 | 50% | 71% | **71%** |
| **cited elsewhere** | 78 | 59% | 92% | **92%** |

The pointer option took 5 real citations out of the flag column and cost nothing on any negative class.

**Adjudicated by reading each flagged real citation against its cited doc (9 flags):** 3 are fair catches — a conjunct the cited doc does not state ("designating support actors **and** resolving disputes"), a "baseline requires **three**" attributed to a doc that says **seven**, and the answer's own security recommendation cited to the framework's Purpose doc. 6 are false: two `contradicts` on "Sky Core" vs the doc's "Sky **Pause Proxy**" (domain equivalence Jev does not know), two partial-support strictness cases where the main clause is stated but a trailing conjunct is not, and two "e.g." pointers the new option missed. **True false-flag rate ≈ 6/80 = 7.5%** — level with the lexical check's 8% (itself unadjudicated), while catching 71% vs 50% on same-title and 92% vs 59% on cited-elsewhere.

### Positive attestation — Jev's `supports` is trustworthy

The question that decides whether this can do more than find contradictions: when Jev says a document **supports** a claim, how often is that wrong? On the repointed negatives:

| class | n | `supports` | explained | **unexplained false support** |
|---|---|---|---|---|
| random | 80 | 0 | — | **0%** |
| parent | 74 | 0 | — | **0%** |
| sibling | 71 | 2 | — | 3% |
| same title | 24 | 6 | 5 have byte-identical content to the original | 4% (1) |
| cited elsewhere | 78 | 6 | 2 identical; reading the other 4, most are genuinely supported ("mutually exclusive pathways" → a doc that says exactly that) | ≤5% |

**Real false support is roughly 3% or less.** That is the number the 2026-09-10 refutation-only overhaul lacked when it retired support verdicts ("a wrong 'supported' passed a real defect") — that was a model judging a whole answer against pooled evidence; this is one sentence against one document, a far narrower claim.

One limit this exposes, true of any content check: for **templated documents with identical text**, nothing can tell Spark's doc from Grove's unless the claim names the agent. 5 of 24 same-title pairs are exactly that.

### What it can do — and the decisions that are not mine to make

- **Refute by citation** (`contradicts`) — a `Contradiction` with `source: "cited-doc"` through the existing `confirm` gate. The two domain-equivalence false contradictions are the kind that gate exists to stop.
- **Unbacked citation** (`says_nothing`) — a soft note, `notFound` precedent. ~7.5% true false-flag; most residual errors are partial-support strictness.
- **Attestation** (`supports`, ≤3% false) — the new capability. It could power an aggregate ("12 of 14 citations checked against their source"), suppress the dark lexical check whenever Jev has ruled, or feed a per-answer confidence. **Two standing rules constrain how it surfaces:** the 2026-09-10 refutation-only stance, and the chat rule of per-item marks only where there is a finding, never rows of default ticks. So a ✓ per citation is out unless that rule changes; an aggregate is the open question.

**Before wiring any of it:** fix the two residual false-flag classes if cheap (partial-support strictness in the criteria — measure the margin, per the A0 lesson that more criteria text can make it worse; domain equivalence via the confirm gate), and decide how `supports` surfaces.

### Wired 2026-09-22 — Sources chip marks

`verify/citation-marks.ts`, started right after `answer_final` and run concurrently with the audit; one `citation_marks` SSE event before `verify_result`; `message_checks` kind `citation_check` keeps the raw verdicts. Per document, worst verdict wins; any unjudged pair ⇒ no mark; pointer-only ⇒ no mark. A ✓ on every backed source is a deliberate exception, chosen by the user, to the "list by exception" rule for stage rows. `CHAT_CITATION_CHECK_MODEL=""` disables it. Not rehydrated on reload, same as the verify badge.

**Live check on three stored answers (real Jev, real confirm on gemma-4-31b):**

| answer | pairs | wall | cost | marks |
|---|---|---|---|---|
| token-transfer ledger | 23 | 4.8 s (incl. one confirm call) | $0.0007 | 20 ✓, 2 – |
| multisig security | 7 | 0.7 s | $0.0002 | 4 ✓, 1 – |
| orgs / roles | 5 | 0.4 s | $0.0001 | 3 ✓, 1 – |

The confirm gate did its job on the first answer: Jev again called the two "Sky Core" vs "Sky **Pause Proxy**" rows `contradicts`; confirm agreed with **0 of 2**, so both surfaced as the muted "doesn't cover" mark, not a warning. The other three muted marks are exactly the three fair catches from the hand adjudication above. The answer is revealed at `answer_final` and the marks arrive while the verify badge is still running, so none of that wall time is added in front of the user.

## Original A1 design notes (pre-measurement)

**Most of this already exists, dark.** `findLowOverlapCitations` (`src/server/chat/verify/verify-checks.ts:537`) already pairs each cited *sentence* with the *one document it links to* — `claimSegments` (`:499`) splits sentences, folds trailing citation-only fragments back, strips anchor text — and scores lexical overlap against `ix.docMap.get(uuid)`. It runs every turn, is persisted to `message_checks.verdict`, and **is read by nothing**: not the badge, not the wire, not the verifier prompt (its "informs the verifier prompt" comment is stale). Jev is its semantic successor on the same seam.

- **Judgment:** one request per (sentence, cited doc): `state = {claim, cited_doc: {title, content, children?}}`, Choice **`supports / contradicts / says_nothing`** (the citation-check cookbook). ~300–500 tokens → ~7 citations/answer ≈ **$0.0001 per answer**, run concurrently *while the answer streams*.
- **Atomization wrinkle:** a parent doc's content no longer contains its children's text, so a sentence citing a parent reads `says_nothing` (the lexical check flags these ~60%). Docs are tiny, so immediate children ride along in state (`ix.childrenIndex`) and the eval measures with/without.
- **What it beats:** lexical overlap can't tell same-template docs apart ("Rate Limits" ×142, one per agent — citing Spark's doc for a Grove claim overlaps perfectly). The model `refute` slice catches `wrong_doc` only **7/12 (0.58)**, at p50 **23.6 s** per call carrying up to 120k chars of evidence.
- **How it surfaces — keeping the 2026-09-10 refutation-only stance** (support-side verdicts were retired because a wrong "supported" passed a real defect):
  - `supports` → **never shown.** No positive claim is ever made.
  - `contradicts` → a `Contradiction` candidate with a new `source: "cited-doc"` (union at `verifier.ts:29`), flowing through the **existing `confirm` gate** — same pattern `absence.ts` uses for `"param-table"`. `evidence_span` = the doc's content when short, else a second Jev Choice over its sentence ids (semantic_find recipe; only on the rare contradict).
  - `says_nothing` → soft per-paragraph finding ("the cited document doesn't cover this statement"), following the `notFound` precedent: informational disclosure, excluded from the chip, copy never implies an error.
- **Streaming seam:** `paragraph-refute.ts`'s semaphore / burst-reset / settle are generic; only `runOne` is refute-specific. Plug-in points are `chat-orchestrator.ts` ≈ `:507` (create), `:549/:582` (submit), `:591` (drain). UI needs one new slot — `ParagraphCheck.model` holds a single model check today. When wiring comes, refactor `runOne` to accept a slice-shaped callback rather than forking the file. *All production wiring is deferred until the eval says yes.*
- Numbers stay in code (`findUngroundedCitationValues`, `param-checks.ts`) — Jev's weakest skill, already covered deterministically.

## A2. "Does the response answer the question?"

**Nothing at runtime measures this today.** Its shape is the `overreach` slot: question + answer only, no evidence, `warn`-or-softer. It targets the default model's *measured* failure mode — under-answering (completeness 0.70 vs 0.95) — and the system prompt's own named failure: "listing the things and omitting the thing asked for."

- **Judgment:** Choice `answers / partial / declines / deflects`. `declines` ("the atlas does not specify X") is a legitimate, responsive outcome and must not be punished; `deflects` subsumes the announcement guard ("one moment while I search…"), which today is regex+embedding at 75% recall.
- **Multi-part questions:** code splits the question (the router already counts `?`), one Noul per part — "does the response address `parts[i]`?" — so the finding *names the dropped part*. Decomposition in code, judgment in Jev.
- **Rollout:** telemetry first (persist + PostHog) to find real bad turns → soft note → only then consider a one-shot retry like the announcement guard's.
- **Labels — thin, and the plan says so.** The bakeoff caches hold ~500 records but they are the same 15 queries × arms × runs: realistically **~75–110 distinct (question, answer) pairs**, each with a strong judge's `completeness` 0–1 (latest run: 50 high / 13 mid / 10 low), joinable to the question by `id`. That judge saw a rubric *and* the evidence, so it is a proxy for "answers the question", not the label. The only **gold** labels are the 28 announcements (`eval-announce-queries.ts`) for `deflects`; `answers / partial / declines` have none. So the A2 eval's first output is a **disagreement list for hand-labeling**, not a score — a scored confusion matrix comes only after that pass.

## A3. Jev as tool caller — not the loop; maybe a first-round router (defer)

The loop is the wrong target. Jev cannot author a search `query`, cannot read 30k-char tool results alongside history in 32k, and the function-calling cookbook covers closed-set arguments only, single-step. **The agentic loop stays with the chat model.**

What does fit: a *speculative first-round router*. Eleven `atlas_report_*` tools are a pure 1-of-N with zero required args; `atlas_params`, `atlas_entity`, `ask_external_msc` take code-resolvable args; 10 of 11 report builders are synchronous in-memory. Since "round count, not token count, is the dominant latency driver" (median turn 82 s) and 11/15 default-model turns are exactly one tool round with one call, a ~0.3 s Jev route that removes a model round could pay for itself — and the same single request would carry the features / census / tier / MSC routes that today run on regex + on-device embeddings (census 86%, tier 13/28, regexes 0/28 on paraphrases).

Against it, from the repo itself: `model-router.ts` states "nothing runs before the first token except code", the archived pre-flight planner was dropped for taxing every turn 1.5–4 s, and `chat-class-completeness.md` says "routing is not the fix". **Defer**; gate it on one read-only query first: the first-round tool distribution in `messages.tool_calls`. That query sends nothing to Jev or anywhere else, so it isn't blocked on anything — it can run alongside step 1. If single closed-set calls aren't a large share of real turns, drop the idea.

## B. Reports

Offline, each its own `pnpm` command, off the `pnpm build` chain. Jev produces a **ranked worklist in `.cache/`, never a new committed artifact**: a human reviews it and the result flows through the curation paths that already exist — `mistakes:merge` + the `rejected[]` list, `processes-apply-decisions.mjs` / the processes-triage runbook, the exclusion JSONs, census `--update`. Nothing model-authored is committed, and the build stays offline and byte-reproducible. Ranked:

1. **Potential Mistakes — false-positive filter.** Measured pain: contradiction pass **26%** false positives, template-divergence detector **47%**. Diagnosed cause: "scores surface incompatibility of isolated sentences" while atlas nesting lets a child or later sentence narrow the earlier one. Jev second opinion per finding, *with the nesting in state*: Choice `real_defect / narrowed_by_context / by_design / wording_only`. Gold labels exist: 42 `rejected[]` + 36 adjudicated rows in `docs/reviews/2026-09-16-*`. Directly improves `/reports/potential-mistakes` and cuts the veto load per sweep.
2. **Processes — whole-corpus recall sweep.** The title-keyword classifier self-reports ~85% recall and misses generic titles ("Implementation", "Stages"). Noul per doc — "ordered sequence where sequence matters?" — over all 11k docs for cents. **Best eval in the repo: 138 curated positives + 67 reasoned negatives.**
3. **GovOps / Facilitator responsibilities — residue triage.** 83 docs "mention GovOps, match no rule" — the set a regex can't call. Noul per (doc, role) → ranked worklist. Gold: `duty-known-exclusions.json` (10), `oea-task-exclusions.json` (18), positives = current report rows.
4. Smaller: `prohibition-language` census (self-declared low precision, 55), liveness's known gap (prose-declared emptiness), OEA's six `present/partial/absent` element labels as an independent second opinion.

Out of scope for Jev (generated text is the product): mistakes-sweep findings, OEA/risk *ratings* + reasoning, `/teach` review, htmlhist curation, `cite:check` (may only ever add flags).

## When this is picked up — first step: measure A1 and A2. No production wiring, no UI.

1. ~~**`src/server/jev.ts`** + colocated test — raw-fetch client, `CHAT_JEV_MODEL`.~~ **DONE 2026-09-22 for A0** — see that section. The smoke-request gate passed: `questions` is a **record, not an array** (an array 400s), and a Noul answers `{type:"noul", noul:0.96}` with `usage.cost` inline and `id: "gen-dec-…"`. The Choice `probabilities`/`confidence` question the gate was written for is **still unconfirmed** — A0 only needed a Noul — so re-check it before building A1's three-way Choice, and keep the three-Noul fallback in reserve.
2. **Export `claimSegments`** from `verify-checks.ts` (one word) so the Jev check and the lexical check can never disagree on what "a cited sentence" is.
3. **`src/server/chat/verify/cite-support.ts`** + test — `citationPairs(answer, ix)` and a pure `buildCiteRequest(pair, ix)` (state + question, unit-testable offline), then `judgeCitation()`. Question criteria written per the primitives guide (one narrow judgment; literal wording; `what / not_for / examples` for the `says_nothing` vs `contradicts` boundary).
4. **`scripts/eval/eval-citation.ts`** + `eval-citation-cases.ts` → `pnpm eval:citation`. Cases: the **84 real citations** in `scripts/eval/eval-corpora/{evidence,fable}` plus deterministic negatives per citation — random doc, **sibling**, **parent**, **same-title-other-agent** (the confusable lexical overlap cannot see) — plus modality/entity flips for `contradicts`. Arms: `findLowOverlapCitations` (incumbent), Jev Choice, Jev two-Noul variant, ± children in state. Disk cache `.cache/jev/<sha256(model+state+questions)>.json` so reruns are free and byte-stable.
5. **`src/server/chat/verify/answers-question.ts`** + **`scripts/eval/eval-answers.ts`** → `pnpm eval:answers`. Silver labels from the bakeoff caches + announcement positives; reports confusion vs the judge's completeness, and prints disagreements for adjudication.
6. **Show the tables before anything else is built** — per-arm catch rate by negative class, false-flag rate on the real citations, p50/p95 latency, total cost.

Files stay ≤ ~150 lines (case builders split from runners); tests colocated; `node:` imports; no new dependency, `pnpm-lock.yaml` untouched.

**Bar to proceed to wiring A1:** on the hard negatives (sibling / same-title) Jev clearly beats the lexical incumbent, at a false-flag rate on real citations low enough that a soft note isn't noise; `contradicts` precision high enough that the confirm gate isn't flooded; and a real-traffic false-flag pass over stored answers before any threshold ships (the census lane learned this the hard way: 12 of 67 real messages false-fired at a corpus-fitted margin).

## Decisions for after the numbers (not blocking step 1)

- A1 `says_nothing`: soft note only, or eventually a `warn`?
- A2: telemetry-only → soft note → retry — how far?
- A3: pursue at all — decided by the first-round tool distribution.
- Reports: which of B1–B3 first (suggested: B1 — measured pain, gold labels).

## Verification (for the first step, when it runs)

- `bun test src/server/jev.test.ts src/server/chat/verify/cite-support.test.ts` — mocked fetch: request shape, backoff, abort, empty-key throw; pair extraction matches `findLowOverlapCitations`' segmentation on shared fixtures.
- `pnpm eval:citation` and `pnpm eval:answers` — a second run makes **0 network requests** (cache) and prints identical numbers.
- With `CHAT_JEV_MODEL=""` or no key: evals exit with a clear message; the server is untouched (nothing imports the new modules on a request path yet).
- `tsc -b` clean; `pnpm build` and `REPRO=1 pnpm test` unaffected — no step added to `scripts/lib/build-steps.mjs`.
- Estimated spend for all of step 1: **well under $0.10**.

## Sources

- TypeSafe docs index: https://docs.typesafe.ai/llms.txt — API (`/api.md`), models (`/models.md`), primitives (`/primitives/*.md`), jaggedness (`/model-jaggedness/jev-1.13.md`), cookbooks `citation_check`, `semantic_find`, `classifying_rag_passages`, `rerank_typesafe`, `function_calling`, `llm_guardrails`.
- OpenRouter integration guide: https://openrouter.ai/docs/guides/community/typesafe-sdk
- Repo survey (2026-09-21): chat judgment sites in `src/server/chat/`, `src/server/facts/`; offline pipelines in `scripts/assess/`, `scripts/aux/mistakes-sweep.mjs`, `scripts/lib/graph-duties.mjs`, the `census:*` scripts; evals under `scripts/eval/`.
