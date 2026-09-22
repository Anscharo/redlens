# Jev (TypeSafe) in SAbR — reference notes

**Status: reference only — not scheduled for implementation** (decided 2026-09-21). Research and design so the work can be picked up later without redoing the survey. Nothing below has been built; no code, config, or dependency in the repo references Jev.

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

## A1. "Is this claim backed up by the doc it references?" — the lead

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

1. **`src/server/jev.ts`** (~70 lines) + colocated test — raw-fetch client to `${config.openrouterBaseUrl}/systemone` with `config.openrouterApiKey`, AbortSignal + bounded backoff (429/529) mirroring `retrieval/embed.ts`; typed `choice()/noul()/score()` builders; returns `{answers, usage, cost, generationId, latencyMs}`. New config `CHAT_JEV_MODEL` (default `typesafe/jev-1.13`; `""` disables — the repo's model-slot convention). **First action, and a gate: one smoke request** to confirm OpenRouter's response carries `probabilities` / `confidence` for a Choice (their guide only shows a Noul answer). If the proxy strips them, A1 becomes **three Nouls** (`supports` / `contradicts` / `says_nothing`, each its own P(yes)) and the eval's arm list changes to match — a fallback, not a stop.
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
