# A "SynLang LLM Wiki" of the Frozen Foundation: Assessment

*Research report, 2026-08-06. Companion report: [frozen-constraints.md](frozen-constraints.md) (what the frozen cohort contains — the would-be encoding payload). Working artifacts: SynLang paper digest and the encoding proof-of-concept, produced by dedicated agents (scratchpad, this session).*

## Question

Would expressing the atlas's frozen foundation (~5,593 docs, ~190K tokens of never-modified, >5-month-old content) in SynLang (arXiv:2507.21067) — a "SynLang LLM wiki" of the atlas's glacial core — improve the reliability and performance of our chatbot?

## Answer

**No, not as stated — the premise fails on the paper, and the token math fails on our corpus.** But the investigation surfaced two genuinely useful mechanisms that keep the spirit of the idea: a **deterministic constraint-parameter table** wired into the chat verifier, and **schema+table compression of the A.6 template**. Both owe nothing to SynLang; both are cheap because the underlying corpus changes glacially.

## 1. What the paper actually is

arXiv:2507.21067 ("SynLang and Symbiotic Epistemology: A Manifesto for Conscious Human-AI Collaboration", Jan Kapusta, 2025) is a philosophy working paper, not an NLP/systems paper. SynLang is a **dialogue-transparency protocol** — `#TASK`/`@AGENT` headers, `>`/`>>` query-and-factor lines, TRACE/TRACE_FE reasoning traces with self-reported confidence floats, and conversational steering directives (`MOD:`, `ONLY:`, `-!`, `-!!`).

Findings that decide the question (full digest reproduces the complete spec + BNF):

- **No knowledge-representation constructs.** Every information-bearing slot in the grammar is free text, a bare identifier, or a confidence float. Declarative facts, deontic rules (must/may/must-not), typed numeric parameters, role-permission relations, process constraints — all five categories a governance rulebook needs are absent. The deontic-looking directives (`ONLY:`, `-!!`) are per-conversation steering commands to the AI, not representations of rules about the world.
- **No relevant evidence.** The empirical basis is one showcased 4-turn dialogue (unnamed model, n≈1, qualitative observations only). No benchmarks, no baselines, no statistics. Token efficiency is never mentioned. SynLang was only ever tested as an *output-formatting* convention — never as a knowledge encoding consumed as context, and RAG is entirely absent from the paper.
- **Purely a convention.** A BNF exists but no parser, validator, or enforcement; TRACE faithfulness to actual model reasoning is untested.

So "encode the rulebook in SynLang" would mean inventing all the needed semantics under a borrowed name. The one defensible carryover — per-claim confidence annotation on answers — is something our verifier already does (`Verdict.claims[].status` + `confidence` in `src/server/chat/verify/verifier.ts`).

## 2. What the encoding PoC measured

Since the real question survives the paper's failure ("would *a* compact formal encoding help?"), we ran a PoC: 16 representative frozen docs (quorum formulas, prohibitions, parameters, role rules, a Type Specification), encoded (a) in strict SynLang per the BNF and (b) in a purpose-built minimal constraint notation ("CDL": deontic operator + actor/action/object + PARAM/DEADLINE lines, one rule per 1–3 lines, UUID-keyed).

| encoding | size vs original prose |
|---|---|
| strict SynLang | **139–235%** (strictly larger — constraint text just lands in `<text>` slots plus scaffolding) |
| CDL, faithful (interpretive residue kept as notes) | **103%** (net expansion) |
| CDL, core only (residue dropped) | 81% (1.23× compression) |
| CDL core, 8-char UUID prefixes | 65% (full 36-char UUIDs alone cost ~25% of encoded tokens) |

Key observations:

1. **The frozen docs are already atomized.** The atlas's authoring style (one rule per doc, terse Cores) means there is very little per-doc prose overhead to squeeze. Faithful encoding is net-negative.
2. **What resists encoding is exactly what causes chatbot errors.** Open-textured standards ("otherwise misaligned"), interpretive examples (PR-mediated code counts as "indirect" contribution), rationale prose. Dropping that residue to reach 81% removes the interpretive content while keeping the parts (numbers, deontics) retrieval already handles well — the worst possible trade for reliability.
3. **The real compression is cross-doc, not per-doc.** ~60% of the frozen A.6 mass is one template instantiated eight times (companion report §2.1). A schema + per-agent parameter table represents thousands of docs losslessly — that's an order-of-magnitude win where per-rule notation manages 1.2×.
4. **Clean fits exist in a narrow band:** parameter docs compressed ~2×, and sharp prohibitions (Crafter-only merge) mapped perfectly to `MUST_NOT`/`ONLY` lines. A typed parameter/prohibition layer is machine-diffable and machine-checkable — valuable for *validation*, irrelevant for *tokens*.

## 3. What would actually move chatbot reliability/perf

Grounded in the current harness (`chat-orchestrator.ts`, `verify/verifier.ts`, `verify/verify-checks.ts`, `system-prompt.ts`):

### 3.1 Constraint-parameter table → verifier grounding (highest value)

The deterministic checks already validate citations, doc_nos, quotes, and addresses in code; numbers are only a *soft* signal (`numbers_not_found_verbatim_in_evidence`, judged by the verifier model). The pending verifier-slices work measured **number-grounding and wrong-doc catch rates as the weak spots** of the live single-prompt verifier.

The frozen cohort is the fix's natural substrate: the companion report's §1.4 numeric constitution (~100 distinct governance/risk parameters + 103 rate-limit docs, all UUID-keyed, all glacially stable) can be extracted **deterministically** (the values sit in typed positions: `` `8.75%` ``, `maxAmount:` lines, "quorum of at least 3") into a build artifact:

```
param(uuid, name, value, unit, scope)   e.g.  (4a1d377d…, capital_ratio, 8.75, %, A.3 risk)
```

Uses, in ascending ambition:
1. **Harden the soft number check**: when an answer states a value for a known parameter name, compare against the table in code — a wrong "capital ratio is 8.5%" becomes a deterministic `fail` instead of a maybe-flag. Slots into `runDeterministicChecks` alongside the existing untraced-numbers scan.
2. **Standing evidence entry**: the orchestrator already injects live schema as `[E0]` evidence so the verifier doesn't flag schema facts as invented. A compact `[E-const]` parameter table (a few KB) is the same pattern for the numeric constitution — it also protects *correct* answers from false "unsupported" verdicts when the model states a well-known frozen parameter it didn't re-retrieve this turn.
3. **Drift tripwire for free**: diffing the table between shas is a `[drift]`-style signal — "a frozen constitutional parameter changed" — as an optional log line, not a dependency (see update path below).

**Update path (decided 2026-08-06): derived in-memory index, not a curated artifact.** The table is a pure function of doc content (`src/lib/`, docs → param rows) computed inside `loadIndexes()`, so it rebuilds exactly when the served docs rebuild — container startup, dev preflight, and the in-process updater's sha-drift hot-swap. No baseline file, no `--update`, no cron, and explicitly **no healer dependency** (the healer isn't reliable enough yet to sit on a correctness path; it may *read* the drift log line, nothing waits on it). Safety property of derived-not-curated: a row can never be stale-wrong — every rebuild re-extracts from the currently-served docs — the only degradation is coverage shrink (a reworded doc stops matching → the row vanishes → one fewer false-absence catch, never a wrong deterministic `fail` against a correct answer).

**Consumption + storage (agreed 2026-08-06):** the table reaches the pipeline three ways, in value order: (1) code only — `runDeterministicChecks` compares answer numbers (and verifier-tagged absence claims) against rows; (2) filtered `[E-const]` standing evidence for the **verifier** — only rows lexically matching the answer text, once per verify call, never amplified through the answer loop; (3) an on-demand params lookup tool for the answerer — explicitly NOT the answerer's system prompt (the Phase 0 A/B measured ~6× loop amplification of standing prompt content). Storage: none — it lives in `Indexes`, in memory, derived per served sha. Not Postgres (a second copy that can disagree with served docs), not committed JSON (violates the artifact model and needs a regenerate-and-commit actor — a cron/healer dependency again). Audit = recomputability at any sha (`build:at` pattern) + `atlas_history` on the underlying docs + an optional per-sha digest/diff line in `sync_log`.

Effort: one pure extraction module in `src/lib/` + a check in `verify-checks.ts`. No model in the loop, reproducible, testable.

**STATUS: BUILT 2026-08-07.** `src/lib/paramIndex.ts` (1,019 rows on the live corpus, 27ms build, in `buildIndexes()`); `findParamMismatches` hard check + absence-claim contract (`verify/absence.ts`: refuted → contradicted, grounded via scaffold/empty evidence, else unverified → requery steer) replacing the sliced verifier's blanket absence exemption; filtered `[E-const]` verifier evidence; `atlas_params` lookup tool. One implementation finding worth keeping: raw kv-key names (`maxamount`) never appear in natural answer phrasing — matching needed a doc-title fallback plus three ambiguity gates (kv-key reuse across per-token docs, multi-param title docs, subset-name shadowing), swept to 0 false positives across all 1,019 rows phrased as correct-value sentences. Cost: only ~⅓ of (title,owner) keys are unambiguously checkable — precision over recall, as designed.

**Review follow-up 2026-08-12.** The check moved to its own module (`verify/param-checks.ts`) — `verify-checks.ts` had grown to 857 lines. Grounding is now **scoped per claim** rather than turn-wide: an absence claim is grounded only by evidence whose query or result text names something the claim also names, so one unrelated `count:0` elsewhere in a multi-tool turn can no longer ground an absence claim about a different parameter (`atlas_params`, whose token-containment matcher returns empty more readily than `atlas_search`, made that path load-bearing). Scoping is per evidence entry, not per row within an entry; a subject-less claim ("the atlas is silent on this") still falls back to turn-wide rather than being demoted outright.

### 3.2 Settled/abandoned tags in retrieval (reliability, not tokens)

The clearest reliability lesson from the corpus itself: half the frozen layer is scaffolding, and a chatbot that retrieves a "Lawyer Registry" doc without knowing the registry is empty overclaims. The censuses already compute liveness; surfacing a `settled | scaffold | placeholder` tag on retrieved docs (in tool results, so both the answerer and the verifier see it) attacks a real failure mode the system prompt currently handles only by exhortation ("a document existing FOR an entity does NOT mean…").

**STATUS: BUILT 2026-08-07.** `src/lib/liveness.ts` (1,224 tagged of 11,149 docs: 962 scaffold from the two structural censuses, 262 placeholder from tuned stub phrases with a 200-char remainder gate), in `buildIndexes()`; tags + one neutral envelope hint ride atlas_get/search/query/neighbors/filter/entity rows; the absence contract reads the tags as grounding. Known gap: prose-declared emptiness ("There are no active legal counsels") is untagged — the structural rule doesn't see it; candidate future heuristic. Inactive Global Activation stays untagged by design (38% steady-state rate = real configuration, not scaffolding).

**Review follow-up 2026-08-12.** The 200-char remainder gate is doc-level, so a SHORT doc that states a real value and defers one sub-detail was tagged `placeholder` — and the absence contract reads that tag as grounding, which is the false-absence hole in miniature. A doc whose non-stub remainder states a value (parseable kv RHS, backticked numeric, bare percentage) is now excluded from the gate: 3 real docs flip out of the placeholder set ("Maple" A.3.2.2.1.1.1.1.3.1 — a stated 3% CRR plus a deferred maximum-exposure clause — and two "Inflow Rate Limits" docs with a specified `maxAmount` beside a deferred `slope`), scaffold counts unchanged. `atlas_neighbors` also now tags its own `target` row, not just the neighbours around it.

### 3.3 A system-prompt "constitutional card" (worth an experiment, strictly bounded)

**STATUS: DEFERRED 2026-08-07** — Phase 0 (constraints-wiki.md) measured the full-card version: navigational wins, +35% input tokens, no help on false absences (now solved in code by §3.1/§3.2). A trimmed v2 rerun on the fixed harness is the open experiment; investigate before applying.

The system prompt today injects structure (doc counts, type vocabularies, entity chains) but zero substantive rules. A ~1–2K-token card of the top settled constraints (companion report §1.1–1.3: hierarchy, amendment formulas, entrenchments, separation-of-powers) would give every turn standing knowledge of the constitution — plausibly fewer retrieval rounds on common "who can change what" questions and better-grounded follow-ups. Costs are real (every-turn tokens, a second source of truth the verifier must treat as evidence like `[E0]`), so this one should be A/B-measured with the existing eval harness before adoption, not assumed. Prose bullets with UUIDs will do; no notation needed.

### 3.4 Template schema + parameter table for A.6 (perf, opportunistic)

**STATUS: DEFERRED 2026-08-07** — build only if the shipped `atlas_params` tool (§3.1) leaves a measurable gap on template-class questions.

For "what are Spark's rate limits"-class questions, retrieval currently pulls many near-identical template leaves. A schema-plus-table artifact (one template description + 8-agent × parameter matrix) answers in one compact tool result. This is the only place the "wiki" framing genuinely pays for itself in tokens — and it's a data-shape change (a curated rollup, like the existing `atlas_report_*` tools), not a notation change. Natural fit: an `atlas_report_agent_template` or an extension of the primitive-matrix report.

### What we should *not* build

- A SynLang encoding of anything — strictly larger, no evidence, no semantics (§1, §2).
- A full-corpus CDL wiki — per-rule encoding of already-atomized prose is net-neutral at best and strips interpretive content at worst.
- TRACE_FE-style reasoning traces in answers — the verifier's claims/confidence output already covers the auditability goal with an actual checking step behind it.

## 4. Verdict

| user's hope | outcome |
|---|---|
| "Express the frozen docs in SynLang" | Not viable — SynLang cannot express them (no fact/rule/parameter constructs); a strict encoding measured 1.4–2.4× *larger* than the prose. |
| "Build a SynLang LLM wiki of the immutable foundation" | The *wiki* idea survives in changed form: a deterministic, UUID-keyed **parameter table + settled/abandoned tags + template schema rollup**, regenerated per atlas bump at near-zero cost because the cohort is glacial. |
| "Improve chatbot reliability" | Real path found — but through the **verifier** (hard number-grounding against the table, `[E-const]` standing evidence, scaffold tags), not through re-encoding knowledge the retrieval layer already serves well. |
| "Improve chatbot perf (tokens/latency)" | Only the A.6 template rollup meaningfully saves tokens; per-rule encoding does not (UUID keys alone eat ~25% of the encoding). |

Recommended order if any of this proceeds: **3.1 (parameter table + deterministic number check)** → 3.2 (liveness tags in tool results) → 3.4 (template rollup) → 3.3 (system-prompt card, only with A/B evidence). Each stage is independently shippable and none blocks on the others.
